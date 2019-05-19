var acorn, arrowFunctionExpression, blockStatement, callExpression, escodegen, expressionStatement, getAndRemoveLibImports, getFunctionLike, getImports, getLibModuleRefs, getParent, getWalkParent, identifier, insertHeader, isIdentifier, isIdentifierNamed, libName, memberExpression, overloadIfThenElse, overloadOperators, preprocessModule, readStrOrListOfStr, remove, replace, replaceQualifiedAccessors, returnStatement, types, walk, walkLibApply,
  indexOf = [].indexOf;

acorn = require('acorn');

walk = require('acorn/dist/walk');

escodegen = require('escodegen');

libName = '@luna-lang/jsnext';

//################
/* AST Utils */
//################
types = {
  arrayExpression: 'ArrayExpression',
  arrowFunctionExpression: 'ArrowFunctionExpression',
  blockStatement: 'BlockStatement',
  callExpression: 'CallExpression',
  functionDeclaration: 'FunctionDeclaration',
  identifier: 'Identifier',
  importDeclaration: 'ImportDeclaration',
  literal: 'Literal',
  memberExpression: 'MemberExpression',
  program: 'Program'
};

memberExpression = function(parser, base, prop) {
  var node;
  node = new acorn.Node(parser);
  node.type = 'MemberExpression';
  node.object = base;
  node.property = prop;
  return node;
};

identifier = function(parser, name, cfg) {
  var node;
  node = new acorn.Node(parser);
  node.type = 'Identifier';
  node.name = name;
  node.loc = cfg.loc;
  return node;
};

callExpression = function(parser, callee, args, cfg) {
  var node;
  node = new acorn.Node(parser);
  node.type = 'CallExpression';
  node.callee = callee;
  node.arguments = args;
  node.loc = cfg.loc;
  return node;
};

expressionStatement = function(parser, expression) {
  var node;
  node = new acorn.Node(parser);
  node.type = 'ExpressionStatement';
  return node.expression = expression;
};

arrowFunctionExpression = function(parser, params, body, cfg) {
  var node;
  node = new acorn.Node(parser);
  node.type = 'ArrowFunctionExpression';
  node.params = params;
  node.body = body;
  node.expression = false;
  node.generator = false;
  node.loc = cfg.loc;
  return node;
};

blockStatement = function(parser, body) {
  var node;
  node = new acorn.Node(parser);
  node.type = 'BlockStatement';
  node.body = body;
  return node;
};

returnStatement = function(parser, argument) {
  var node;
  node = new acorn.Node(parser);
  node.type = 'ReturnStatement';
  node.argument = argument;
  return node;
};

exports.isIdentifier = isIdentifier = function(ast) {
  return ast.type === types.identifier;
};

exports.isIdentifierNamed = isIdentifierNamed = function(name, ast) {
  return (isIdentifier(ast)) && (ast.name === name);
};

replace = function(parent, oldVal, newVal) {
  var el, i, j, k, len, v;
  for (k in parent) {
    v = parent[k];
    if (v === oldVal) {
      parent[k] = newVal;
      return;
    } else if (v instanceof Array) {
      for (i = j = 0, len = v.length; j < len; i = ++j) {
        el = v[i];
        if (el === oldVal) {
          v[i] = newVal;
          return;
        }
      }
    }
  }
  throw 'Insufficient pattern match.';
};

remove = function(parent, oldVal) {
  var el, i, j, k, len, v;
  for (k in parent) {
    v = parent[k];
    if (v === oldVal) {
      throw 'Cannot remove non-optional value';
    } else if (v instanceof Array) {
      for (i = j = 0, len = v.length; j < len; i = ++j) {
        el = v[i];
        if (el === oldVal) {
          v.splice(i, 1);
          return;
        }
      }
    }
  }
  throw 'Insufficient pattern match.';
};

exports.getFunctionLike = getFunctionLike = function(ast) {
  if ((ast.type === types.blockStatement) && (ast.expression.type === types.arrowFunctionExpression)) {
    return ast.expression;
  } else if (ast.type === types.functionDeclaration) {
    return ast;
  } else {
    return null;
  }
};

exports.getImports = getImports = function(ast) {
  var imports;
  imports = [];
  walk.ancestor(ast, {
    ImportDeclaration: function(node, ancestors) {
      return imports.push(node);
    }
  });
  return imports;
};

exports.getAndRemoveLibImports = getAndRemoveLibImports = function(ast, modName) {
  var imports;
  imports = [];
  walk.ancestor(ast, {
    ImportDeclaration: function(node, ancestors) {
      if (node.source.value === modName) {
        return imports.push(node);
      }
    },
    CallExpression: function(node, ancestors) {
      var _, decl, j;
      if (node.callee.name === 'require' && node.arguments.length === 1 && node.arguments[0].value === modName) {
        j = ancestors.length - 2, decl = ancestors[j++], _ = ancestors[j++];
        return imports.push(decl);
      }
    }
  });
  return imports;
};

// Reads str expression or gets all str expressions from list
readStrOrListOfStr = function(ast) {
  var el, j, len, out, ref;
  out = [];
  if (ast.type === types.literal) {
    out.push(ast.value);
  } else if (ast.type === types.arrayExpression) {
    ref = ast.elements;
    for (j = 0, len = ref.length; j < len; j++) {
      el = ref[j];
      if (el.type === types.literal) {
        out.push(el.value);
      }
    }
  }
  return out;
};

//##################
/* AST walking */
//##################
exports.getWalkParent = getWalkParent = function(ancestors) {
  return ancestors[ancestors.length - 2];
};

exports.getParent = getParent = function(ancestors) {
  return ancestors[ancestors.length - 1];
};

//########################
/* Module processing */
//########################

// Get references to all local variables refering to this library
exports.getLibModuleRefs = getLibModuleRefs = function(ast, modName) {
  var imp, imports, j, len, ref, ref1, results;
  imports = getAndRemoveLibImports(ast, modName);
  results = [];
  for (j = 0, len = imports.length; j < len; j++) {
    imp = imports[j];
    // ImportDeclarion or VariableDeclartion + CallExpression
    results.push(((ref = imp.specifiers) != null ? ref[0].local.name : void 0) || ((ref1 = imp.id) != null ? ref1.name : void 0));
  }
  return results;
};

// Walks AST and executes `f` on every expression like `jsnext.apply ...`
walkLibApply = function(libRefs, ast, callName, f) {
  return walk.ancestor(ast, {
    MemberExpression: function(node, ancestors) {
      var parent, ref;
      if ((isIdentifier(node.object)) && (ref = node.object.name, indexOf.call(libRefs, ref) >= 0)) {
        if (isIdentifierNamed(callName, node.property)) {
          parent = getWalkParent(ancestors);
          return f(parent, ancestors.slice(0, -2));
        }
      }
    }
  });
};

exports.preprocessModule = preprocessModule = function(fileName, extensionMap, code, cfg = {}) {
  var ast, callName, changed, defaultExts, gen, libRefs, modName, parser;
  changed = false;
  parser = new acorn.Parser({
    ecmaVersion: 9,
    sourceType: 'module',
    locations: true,
    sourceFile: fileName
  }, code);
  ast = parser.parse();
  modName = cfg.library || libName;
  callName = cfg.call || 'apply';
  defaultExts = cfg.defaultExts || [];
  libRefs = getLibModuleRefs(ast, modName);
  walkLibApply(libRefs, ast, callName, function(node, ancestors) {
    var ext, extensions, fext, fexts, j, l, len, len1, localAncestors, localAst, parent;
    changed = true;
    if (node.type === types.callExpression) {
      switch (node.arguments.length) {
        case 2:
          extensions = defaultExts.concat(readStrOrListOfStr(node.arguments[0]));
          localAst = node.arguments[1];
          break;
        case 1:
          extensions = defaultExts;
          localAst = node.arguments[0];
          break;
        default:
          throw 'Unsupported AST shape.';
      }
      localAncestors = ancestors.slice();
      localAncestors.push(node);
      for (j = 0, len = extensions.length; j < len; j++) {
        ext = extensions[j];
        fexts = extensionMap[ext];
        if (fexts != null) {
          for (l = 0, len1 = fexts.length; l < len1; l++) {
            fext = fexts[l];
            fext(parser, localAst, localAncestors);
          }
        }
      }
    }
    parent = getParent(ancestors);
    return replace(parent, node, localAst);
  });
  gen = escodegen.generate(ast, {
    sourceMap: true,
    sourceMapWithCode: true
  });
  if (changed) {
    return gen.code;
  } else {
    return code;
  }
};

//##################################
/* Example AST transformations */
//##################################

// Overload operators according to rules
// >> overloadOperators (opname) => "operator" + opname
// converts `a + b` to `operator+(a,b)`
exports.overloadOperators = overloadOperators = (f) => {
  return (parser, ast, ancestors) => {
    var handleExpr;
    handleExpr = (node, ancestors, name, nexpr) => {
      var call, parent, prop;
      parent = getWalkParent(ancestors);
      name = f(name);
      if (name) {
        prop = identifier(parser, name, {
          loc: node.loc
        });
        call = callExpression(parser, prop, nexpr, {
          loc: node.loc
        });
        return replace(parent, node, call);
      }
    };
    return walk.ancestor(ast, {
      UnaryExpression: (node, ancestors) => {
        return handleExpr(node, ancestors, `prefix${node.operator}`, [node.argument]);
      },
      UpdateExpression: (node, ancestors) => {
        return handleExpr(node, ancestors, `postfix${node.operator}`, [node.argument]);
      },
      BinaryExpression: (node, ancestors) => {
        return handleExpr(node, ancestors, node.operator, [node.left, node.right]);
      }
    });
  };
};

// Overload if ... then ... else ... expression
// >> overloadIfThenElse 'ite'
// converts `if (a == b) {f = 1} else {f = 2}` to `ite (a == b) (() => {f = 1}) (() => {f = 2})`
exports.overloadIfThenElse = overloadIfThenElse = (name) => {
  return (parser, ast, ancestors) => {
    return walk.ancestor(ast, {
      IfStatement: (node, ancestors) => {
        var alt, args, body, call, parent, prop;
        parent = getWalkParent(ancestors);
        prop = identifier(parser, name, {
          loc: node.loc
        });
        body = arrowFunctionExpression(parser, [], node.consequent, {
          loc: node.consequent.loc
        });
        args = [node.test, body];
        if (node.alternate != null) {
          alt = arrowFunctionExpression(parser, [], node.alternate, {
            loc: node.alternate.loc
          });
          args.push(alt);
        }
        call = callExpression(parser, prop, args, {
          loc: node.loc
        });
        return replace(parent, node, call);
      }
    });
  };
};

// Replace qualified accessors
// >> replaceQualifiedAccessors 'Math', 'X.Math'
// converts `Math.sin(a)` to `X.Math.sin(a)`
exports.replaceQualifiedAccessors = replaceQualifiedAccessors = (name, newName) => {
  return (parser, ast, ancestors) => {
    return walk.ancestor(ast, {
      MemberExpression: (node, ancestors) => {
        if ((node.object.type === types.identifier) && (node.object.name === name)) {
          return node.object.name = newName;
        }
      }
    });
  };
};

// Insert arbitrary code to header.
// WARNING: Unsafe! Run after all other passes, the code is handled as variable, so it produces invalid AST.
exports.insertHeader = insertHeader = (raw) => {
  return (parser, ast, ancestors) => {
    var code;
    if (ast.type === types.callExpression) {
      code = identifier(parser, raw, {
        loc: ast.loc
      });
      return ast.callee.body.body.unshift(code);
    }
  };
};
