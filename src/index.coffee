
import * as acorn     from "acorn"
import * as walk      from "acorn/dist/walk"
import * as escodegen from "escodegen"

libName = 'jsnext'


#################
### AST Utils ###
#################

types =
  arrayExpression         : 'ArrayExpression'
  arrowFunctionExpression : 'ArrowFunctionExpression'
  blockStatement          : 'BlockStatement'
  callExpression          : 'CallExpression'
  functionDeclaration     : 'FunctionDeclaration'
  identifier              : 'Identifier'
  importDeclaration       : 'ImportDeclaration'
  literal                 : 'Literal'
  memberExpression        : 'MemberExpression'
  program                 : 'Program'

memberExpression = (parser, base, prop) ->
  node          = new acorn.Node parser
  node.type     = 'MemberExpression'
  node.object   = base
  node.property = prop
  node

identifier = (parser, name, cfg) ->
  node      = new acorn.Node parser
  node.type = 'Identifier'
  node.name = name
  node.loc  = cfg.loc
  node

callExpression = (parser, callee, args, cfg) ->
  node           = new acorn.Node parser
  node.type      = 'CallExpression'
  node.callee    = callee
  node.arguments = args
  node.loc       = cfg.loc
  node

expressionStatement = (parser, expression) ->
  node            = new acorn.Node parser
  node.type       = 'ExpressionStatement'
  node.expression = expression

arrowFunctionExpression = (parser, params, body, cfg) ->
  node            = new acorn.Node parser
  node.type       = 'ArrowFunctionExpression'
  node.params     = params
  node.body       = body
  node.expression = false
  node.generator  = false
  node.loc        = cfg.loc
  node

blockStatement = (parser, body) ->
  node      = new acorn.Node parser
  node.type = 'BlockStatement'
  node.body = body
  node

returnStatement = (parser, argument) ->
  node          = new acorn.Node parser
  node.type     = 'ReturnStatement'
  node.argument = argument
  node


export isIdentifier = (ast) -> ast.type == types.identifier
export isIdentifierNamed = (name, ast) -> (isIdentifier ast) && (ast.name == name)


replace = (parent, oldVal, newVal) ->
  for k,v of parent
    if (v == oldVal)
      parent[k] = newVal
      return
    else if v instanceof Array
      for el,i in v
        if el == oldVal
          v[i] = newVal
          return
  console.log "OH NO"


export getFunctionLike = (ast) ->
  if (ast.type == types.blockStatement) && (ast.expression.type == types.arrowFunctionExpression)
    return ast.expression
  else if (ast.type == types.functionDeclaration)
    return ast
  else return null

export getImports = (ast) ->
  imports = []
  if ast.type == types.program
    for node in ast.body
      if node.type == types.importDeclaration
        imports.push node
  else throw "Unsupported ast type `#{ast.type}`"
  return imports


# Reads str expression or gets all str expressions from list
readStrOrListOfStr = (ast) ->
  out = []
  if ast.type == types.literal
    out.push ast.value
  else if ast.type == types.arrayExpression
    for el in ast.elements
      if el.type == types.literal
        out.push el.value
  out



###################
### AST walking ###
###################

export getWalkParent = (ancestors) -> ancestors[ancestors.length - 2]
export getParent     = (ancestors) -> ancestors[ancestors.length - 1]



#########################
### Module processing ###
#########################

# Get references to all local variables refering to this library
export getLibModuleRefs = (ast) ->
  imports = getImports ast
  refs    = []
  for imp in imports
    if imp.source.value == libName then refs.push imp.specifiers[0].local.name
  refs

# Walks AST and executes `f` on every expression like `jsnext.apply ...`
walkLibApply = (libRefs, ast, f) ->
  walk.ancestor ast,
    MemberExpression: (node, ancestors) ->
      if (isIdentifier node.object) && (node.object.name in libRefs)
        if isIdentifierNamed 'apply', node.property
          parent = getWalkParent ancestors
          f parent, ancestors.slice(0,-2)


export preprocessModule = (fileName, extensionMap, code) ->
  changed = false
  parser  = new acorn.Parser {sourceType: 'module', locations:true, sourceFile:fileName}, code
  ast     = parser.parse()
  libRefs = getLibModuleRefs ast
  walkLibApply libRefs, ast, (node, ancestors) ->
    changed = true
    if node.type == types.callExpression
      extensions     = readStrOrListOfStr node.arguments[0]
      localAst       = node.arguments[1]
      localAncestors = ancestors.slice()
      localAncestors.push node
      for ext in extensions
        fexts = extensionMap[ext]
        if fexts? then for fext in fexts
          fext parser, localAst, localAncestors
    parent = getParent ancestors
    console.log '---'
    console.log node
    console.log parent
    replace parent, node, localAst
  gen = escodegen.generate ast,
    sourceMap: true
    sourceMapWithCode: true
  if changed then return gen.code else return code



###################################
### Example AST transformations ###
###################################


# Overload operators according to rules
# >> overloadOperators (opname) => "operator" + opname
# converts `a + b` to `operator+(a,b)`
export overloadOperators = (f) => (parser, ast, ancestors) =>
  handleExpr = (node, ancestors, name, nexpr) =>
    parent = getWalkParent ancestors
    name   = f name
    if name
      prop = identifier parser, name, {loc: node.loc}
      call = callExpression parser, prop, nexpr, {loc: node.loc}
      replace parent, node, call

  walk.ancestor ast,
    UnaryExpression  : (node, ancestors) => handleExpr node, ancestors, "prefix#{node.operator}"  , [node.argument]
    UpdateExpression : (node, ancestors) => handleExpr node, ancestors, "postfix#{node.operator}" , [node.argument]
    BinaryExpression : (node, ancestors) => handleExpr node, ancestors, node.operator             , [node.left, node.right]


# Overload if ... then ... else ... expression
# >> overloadIfThenElse 'ite'
# converts `if (a == b) {f = 1} else {f = 2}` to `ite (a == b) (() => {f = 1}) (() => {f = 2})`
export overloadIfThenElse = (name) => (parser, ast, ancestors) =>
  walk.ancestor ast,
    IfStatement: (node, ancestors) =>
      parent = getWalkParent ancestors
      prop   = identifier parser, name, {loc: node.loc}
      body   = arrowFunctionExpression parser, [], node.consequent, {loc: node.consequent.loc}
      args   = [node.test, body]
      if node.alternate?
        alt = arrowFunctionExpression parser, [], node.alternate , {loc: node.alternate.loc}
        args.push alt
      call   = callExpression parser, prop, args, {loc: node.loc}
      replace parent, node, call


# Replace qualified accessors
# >> replaceQualifiedAccessors 'Math', 'X.Math'
# converts `Math.sin(a)` to `X.Math.sin(a)`
export replaceQualifiedAccessors = (name, newName) => (parser, ast, ancestors) =>
  walk.ancestor ast,
    MemberExpression: (node, ancestors) =>
      if (node.object.type == types.identifier) && (node.object.name == name)
        node.object.name = newName


# Insert arbitrary code to header.
# WARNING: Unsafe! Run after all other passes, the code is handled as variable, so it produces invalid AST.
export insertHeader = (raw) => (parser, ast, ancestors) =>
  if ast.type == types.callExpression
    code = identifier parser, raw, {loc: ast.loc}
    ast.callee.body.body.unshift code