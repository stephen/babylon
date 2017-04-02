import { types as tt } from "../tokenizer/types";
// import { types as ct } from "../tokenizer/context";
import Parser from "../parser";

// XXX: targeting ts1.8 grammar:
// https://github.com/Microsoft/TypeScript/blob/master/doc/spec.md#A
// also see https://github.com/babel/babylon/issues/320
const pp = Parser.prototype;

pp.tsParseInterface = function(node) {
  node.id = this.parseIdentifier();

  node.typeParameters = null;
  if (this.isRelational("<")) {
    node.typeParameters = this.tsParseTypeParameters();
  }

  node.extends = [];
  if (this.eat(tt._extends)) {
    do {
      node.extends.push(this.tsParseHeritageClause());
    } while (this.eat(tt.comma));
  }

  this.tsParseObjectTypeish(node);

  return this.finishNode(node, "InterfaceDeclaration");
};

// parses the latter half of `extends Something`.
// caller must remove `extends` themself.
// from: flowParseInterfaceExtends
pp.tsParseHeritageClause = function() {
  const node = this.startNode();
  node.id = this.tsParseTypeName();

  // XXX: it seems like flow calls ts.TypeArguments (the <T> part)
  // flow.TypeParamterInstantiation, which are concrete type refs that
  // cannot be newly declared generics. Different from ts.TypeParameter.

  // extended type can be generic and have a TypeArguments, i.e. `extends Something<T>`
  if (this.isRelational("<")) {
    node.typeArguments = this.tsParseTypeArgumentList();
  } else {
    node.typeArguments = null;
  }

  // XXX: flow calls these InterfaceExtends
  return this.finishNode(node, "HeritageClause");
};

// stuff like `X.G` within `var x: X.G<T>`
// XXX: Flow calls these QualifiedTypeIdentifier;
// official ts ast calls these PropertyAccessExpression,
// while the spec grammar calls them TypeName.
//
// The ts ast also calls a.s()'s expression a PropertyAccessExpression,
// maybe we should just call these MemberExpression?
// typescript-eslint-parser also converts these into MemberExpression.
//
// We can't just call pp.parseExprSubscripts because it also attempts to
// parse things like a[c] which are valid MemberExpression's, but not
// valid typescript type names.
//
// This is taken from flowParseQualifiedTypeIdentifier.
pp.tsParseTypeName = function(identifier) {
  let node = identifier || this.parseIdentifier();

  while (this.eat(tt.dot)) {
    const node2 = this.startNode();
    node2.object = node;
    node2.property = this.parseIdentifier();
    node = this.finishNode(node2, "MemberExpression");
  }

  return node;
};

// similar to flowParseTypeParameterInstantiation
pp.tsParseTypeArgumentList = function() {
  // XXX: inType?
  const node = this.startNode();
  node.arguments = [];

  this.expectRelational("<");
  while (!this.isRelational(">")) {
    node.arguments.push(this.tsParseType());
    if (!this.isRelational(">")) {
      this.expect(tt.comma);
    }
  }
  this.expectRelational(">");

  return this.finishNode(node, "TypeArgumentList");
};

// via flowParseTypeParameterDeclaration.
// From the spec: TypeParameters.
pp.tsParseTypeParameters = function() {
  // XXX: inType?
  const parameters = [];

  this.expectRelational("<");
  do {
    parameters.push(this.tsParseTypeParameter());
    if (!this.isRelational(">")) {
      this.expect(tt.comma);
    }
  } while (!this.isRelational(">"));
  this.expectRelational(">");

  return parameters;
};

const typeIdentifierReservedWords = [
  "any",
  "boolean",
  "number",
  "string",
  "symbol",
  // XXX: note that using `void` in e.g. a TypeParameterList
  // produces a different error in the ts compiler than the above:
  // interface X<S, void> {}
  "void",
];

pp.tsParseTypeIdentifier = function(liberal) {
  if (typeIdentifierReservedWords.indexOf(this.state.value) > -1) {
    this.raise(this.state.start, `Cannot use ${this.state.value} as a type identifier`);
  }

  return this.parseIdentifier(liberal);
};

pp.tsParseTypeParameter = function() {
  const node = this.startNode();
  node.name = this.tsParseTypeIdentifier();

  // XXX: https://github.com/Microsoft/TypeScript/blob/master/doc/spec.md#7
  // flow calls the possible `extends` clause bounded polymorphism
  // and the flow plugin calls just a .typeAnnotation.
  // See: flowParseTypeAnnotatableIdentifier + flowParseTypeParameter
  node.constraint = null;
  if (this.eat(tt._extends)) {
    node.constraint = this.tsParseType();
  }

  return this.finishNode(node, "TypeParameter");
};

pp.tsParsePredefinedType = function(node, identifier) {
  switch (identifier.name) {
    case "any":
      // XXX: flow.AnyTypeAnnotation
      return this.finishNode(node, "AnyKeyword");

    case "number":
      // XXX: flow.NumberTypeAnnotation
      return this.finishNode(node, "NumberKeyword");

    case "boolean":
      // XXX: flow.BooleanTypeAnnotation
      return this.finishNode(node, "BooleanKeyword");

    case "string":
      // XXX: flow.StringTypeAnnotation
      return this.finishNode(node, "StringKeyword");

    case "symbol":
      // XXX: does not exist in flow
      return this.finishNode(node, "SymbolKeyword");

    case "void":
      // XXX: flow.VoidTypeAnnotation
      return this.finishNode(node, "VoidKeyword");

    default:
      return null;
  }
};

// XXX: flowParseGenericType
pp.tsParseTypeReference = function(node, identifier) {
  node.typeArguments = null;
  node.id = this.tsParseTypeName(identifier);

  if (this.isRelational("<")) {
    node.typeArguments = this.tsParseTypeArgumentList();
  }

  // XXX: flow.GenericTypeAnnotation
  return this.finishNode(node, "TypeReference");
};

// existingNode used for Interface declaration parsing
// since `members` is directly on the InterfaceDeclaration node.
// otherwise, it's an object TypeLiteral, i.e. var x: { y: string; ... };
pp.tsParseObjectType = function() {
  // XXX: inType?
  const node = this.startNode();
  this.tsParseObjectTypeish(node);

  // XXX: flow ObjectTypeAnnotation
  return this.finishNode(node, "TypeLiteral");
};

pp.tsParseObjectTypeish = function(node) {
  this.expect(tt.braceL);

  // flow splits this into callProperties, properties, and indexers.
  // the TS compiler puts them into a single property
  node.members = [];

  // PropertySignature `name?: TypeAnnotation`
  // CallSignature `<A, B>(a, b): T`
  // ConstructSignature `new <A, B>(a, b) T`
  // IndexSignature `[name: string]: number`
  // MethodSignature `name?: CallSignature`
  while (!this.match(tt.braceR)) {
    if (this.match(tt.bracketL)) {
      // Attempt to parse as a property/method signature with a computed
      // property name, e.g. `[Symbol.iterator]?(): number;`. If that fails,
      // then attempt to parse as an index signature e.g. `[x: number]: string;`
      const state = this.state.clone();
      try {
        node.members.push(this.tsParseObjectTypePropertyOrMethodSignature());
      } catch (err) {
        this.state = state;
        node.members.push(this.tsParseObjectTypeIndexSignature());
      }

    } else if (this.match(tt._new)) {
      node.members.push(this.tsParseObjectTypeConstructSignature());
    } else if (this.match(tt.parenL) || this.isRelational("<")) {
      node.members.push(this.tsParseObjectTypeCallSignature());
    } else if (this.match(tt.name)) {
      node.members.push(this.tsParseObjectTypePropertyOrMethodSignature());
    } else {
      this.unexpected();
    }
  }
  this.expect(tt.braceR);

  return node;
};

pp.tsParsePropertyName = function() {
  // estree ObjectProperty. Flow babylon 6 does this wrong as an ObjectTypeIndexer
  if (this.eat(tt.bracketL)) {
    const node = this.startNode();
    node.expression = this.parseMaybeAssign();
    this.expect(tt.bracketR);
    // babylon does not have a "ComputedPropertyName" node.
    // Instead, ObjectProperty (ObjectTypeProperty for flow,
    // PropertySignature for ts) has a `computed` field
    // that speifies whether or not it's computed, and the
    // assignment expression is directly on that node as `key`.
    // We cannot follow that pattern while also preserving TS
    // PropertySignature.
    //
    // Also, this node can only be a well-known Symbol
    // within types.
    return this.finishNode(node, "ComputedPropertyName");
  }

  switch (this.state.type) {
    case tt.num:
      return this.parseLiteral(this.state.value, "NumericLiteral");
    case tt.string:
      return this.parseLiteral(this.state.value, "StringLiteral");
    case tt.name:
      return this.parseIdentifier(true);
    default:
      this.unexpected();
  }
};

pp.tsParseObjectTypePropertyOrMethodSignature = function() {
  const node = this.startNode();
  let nodeType = "PropertySignature";
  // need to parse PropertyName, which can be computed
  // is TS: computed names can only be well defined symbols
  node.name = this.tsParsePropertyName();

  if (this.match(tt.question)) {
    const questionNode = this.startNode();
    this.expect(tt.question);
    node.questionToken = this.finishNode(questionNode, "QuestionToken");
  }

  if (this.isRelational("<") || this.match(tt.parenL)) {
    nodeType = "MethodSignature";
    this.tsParseObjectTypeFunctionish(node);
  } else if (this.eat(tt.colon)) {
    node.typeAnnotation = this.tsParseType();
  }

  this.tsEatObjectTypeSemicolon();
  return this.finishNode(node, nodeType);
};

// parse ConstructSignature / CallSignature:
// TypeParameters (ParameterList) TypeAnnotation
// new TypeParameters (ParameterList) TypeAnnotation
// This is similar to tsParseFunctionish, except
// the type annotation at the end is an optional
// `: Type` instead of a required `=> Type`
pp.tsParseObjectTypeFunctionish = function(node) {
  node.typeParameters = null;
  if (this.isRelational("<")) {
    node.typeParameters = this.tsParseTypeParameters();
  }

  this.expect(tt.parenL);
  node.parameters = this.tsParseParameterList();
  this.expect(tt.parenR);

  // Lack of a colon annotates an implicit `any`.
  if (this.eat(tt.colon)) {
    node.typeAnnotation = this.tsParseType();
  }

  return node;
};

pp.tsParseObjectTypeCallSignature = function() {
  const node = this.startNode();
  this.tsParseObjectTypeFunctionish(node);
  this.tsEatObjectTypeSemicolon();
  return this.finishNode(node, "CallSignature");
};

pp.tsParseObjectTypeConstructSignature = function() {
  const node = this.startNode();
  this.expect(tt._new);
  this.tsParseObjectTypeFunctionish(node);
  this.tsEatObjectTypeSemicolon();
  return this.finishNode(node, "ConstructSignature");
};

pp.tsParseObjectTypeIndexSignature = function() {
  const node = this.startNode();
  node.parameters = [];

  const paramNode = this.startNode();

  this.expect(tt.bracketL);
  // XXX: flow calls this id / key
  paramNode.name = this.parseIdentifier();
  this.expect(tt.colon);

  // XXX: ts compiler `type`
  // flow calls this `key`
  paramNode.typeAnnotation = this.tsParseType();
  if (["StringKeyword", "NumberKeyword"].indexOf(paramNode.typeAnnotation.type) === -1) {
    this.raise(paramNode.typeAnnotation.start, "Object indexer can only have string or number type");
  }

  // XXX: flow does not have this level of indirection. the parameters live
  // directly on the ObjectTypeIndexed as id / key / value
  node.parameters.push(this.finishNode(paramNode, "Parameter"));
  this.expect(tt.bracketR);
  this.expect(tt.colon); // XXX: flow handles this with flowParseTypeInitialiser

  // XXX: ts compiler `type`
  // flow calls this `value`
  node.typeAnnotation = this.tsParseType();

  this.tsEatObjectTypeSemicolon();
  return this.finishNode(node, "IndexSignature");
};

// XXX: flowObjectTypeSemicolon
pp.tsEatObjectTypeSemicolon = function() {
  if (!this.eat(tt.semi) && !this.eat(tt.comma) &&
      !this.match(tt.braceR)) {
    this.unexpected();
  }
};

pp.tsParseTupleType = function(node) {
  this.expect(tt.bracketL);
  node.elementTypes = [];

  while (!this.match(tt.bracketR)) {
    node.elementTypes.push(this.tsParseType());
    if (!this.match(tt.bracketR)) {
      this.expect(tt.comma);
    }
  }
  this.expect(tt.bracketR);
  this.tsEatObjectTypeSemicolon();
  return this.finishNode(node, "TupleType");
};

pp.tsParseTypeQuery = function(node) {
  this.expect(tt._typeof);
  // XXX: ts calls this FirstNode?
  // see notes on tsParseTypeName.
  node.exprName = this.tsParseTypeName();
  // XXX: TypeofTypeAnnotation
  return this.finishNode(node, "TypeQuery");
};

pp.tsParsePrimaryType = function() {
  const node = this.startNode();
  switch (this.state.type) {
    case tt.name:
      const identifier = this.parseIdentifier();
      return this.tsParsePredefinedType(node, identifier) || this.tsParseTypeReference(node, identifier);
    case tt.braceL:
      return this.tsParseObjectType();
    case tt._this:
      // XXX: flow ThisTypeAnnotation
      this.expect(tt._this);
      return this.finishNode(node, "ThisType");
    case tt._typeof:
      return this.tsParseTypeQuery(node);
    case tt.bracketL:
      return this.tsParseTupleType(node);
    case tt.parenL:
      this.expect(tt.parenL);
      // Discard `node` from above.
      const type = this.tsParseType();
      this.expect(tt.parenR);
      return type;
  }
};

pp.tsParseMaybeArrayType = function() {
  let type = this.tsParsePrimaryType();
  // while loop, because we could have number[][]
  while (!this.canInsertSemicolon() && this.match(tt.bracketL)) {
    // XXX: fix node line start position /location
    const node = this.startNode();
    node.elementType = type;
    this.expect(tt.bracketL);
    this.expect(tt.bracketR);
    // XXX: flow ArrayTypeAnnotation
    type = this.finishNode(node, "ArrayType");
  }
  return type;
};

const modifierMap = {
  "public": "PublicKeyword",
  "private": "PrivateKeyword",
  "protected": "ProtectedKeyword",
};

pp.tsIsModifierKeyword = function() {
  return this.match(tt.name) && modifierMap[this.state.value];
};

pp.tsParseParameter = function() {
  const node = this.startNode();

  node.modifiers = null;
  const maybeModifierValue = this.state.value;
  if (this.tsIsModifierKeyword()) {
    const modifier = this.startNode();
    this.next();
    node.modifiers = [this.finishNode(modifier, modifierMap[maybeModifierValue])];
  }

  if (this.eat(tt.braceL)) {
    if (node.modifiers) {
      this.raise(node.start, "Cannot use a accessibility modifier with a destructuring pattern");
    }

    node.name = this.parseObj(true); // isPattern = true
  } else {
    node.name = this.parseIdentifier();
  }

  if (this.match(tt.question)) {
    const questionNode = this.startNode();
    this.expect(tt.question);
    node.questionToken = this.finishNode(questionNode, "QuestionToken");
  }

  if (this.eat(tt.colon)) {
    // XXX: support string literal type checking
    node.typeAnnotation = this.tsParseType();
  }
  // XXX: support parameter initializers...

  // XXX: flow FunctionTypeParam
  return this.finishNode(node, "Parameter");
};

// XXX: flowParseFunctionTypeParams
pp.tsParseParameterList = function() {
  const params = [];
  while (!this.match(tt.parenR) && !this.match(tt.ellipsis)) {
    params.push(this.tsParseParameter());
    if (!this.match(tt.parenR)) {
      this.expect(tt.comma);
    }
  }
  if (this.eat(tt.ellipsis)) {
    params.push(this.tsParseParameter());
  }

  // XXX: enforce ordering: required, optional, rest
  return params;
};

// parse constructor type / function type signatures:
// TypeParameters (ParameterList) => Type
pp.tsParseFunctionish = function(node) {
  node.typeParameters = null;
  if (this.isRelational("<")) {
    node.typeParameters = this.tsParseTypeParameters();
  }

  this.expect(tt.parenL);
  node.parameters = this.tsParseParameterList();
  this.expect(tt.parenR);
  this.expect(tt.arrow);

  node.typeAnnotation = this.tsParseType();

  return node;
};

pp.tsParseConstructorType = function() {
  const node = this.startNode();
  this.expect(tt._new);
  this.tsParseFunctionish(node);
  return this.finishNode(node, "ConstructorType");
};

pp.tsParseFunctionType = function() {
  const node = this.startNode();
  this.tsParseFunctionish(node);
  return this.finishNode(node, "FunctionType");
};

pp.tsParseMaybeIntersectionType = function() {
  // `node` will be discarded if there is no intersection type
  const node = this.startNode();
  const type = this.tsParseMaybeArrayType();
  node.types = [type];
  while (this.eat(tt.bitwiseAND)) {
    node.types.push(this.tsParseMaybeArrayType());
  }
  return node.types.length === 1 ? type : this.finishNode(node, "IntersectionType");
};

pp.tsParseMaybeUnionType = function() {
  // `node` will be discarded if there is no union type
  const node = this.startNode();
  const type = this.tsParseMaybeIntersectionType();
  node.types = [type];
  while (this.eat(tt.bitwiseOR)) {
    node.types.push(this.tsParseMaybeIntersectionType());
  }
  return node.types.length === 1 ? type : this.finishNode(node, "UnionType");
};

pp.tsParseType = function() {
  if (this.match(tt._new)) {
    return this.tsParseConstructorType();
  } else if (this.isRelational("<")) {
    return this.tsParseFunctionType();
  } else if (this.match(tt.parenL)) {
    // The grammar is potentially ambiguous here,
    // because a left paren could be
    // - a grouped type: (number | string)[]
    // - a function type: (x: number) => string;

    // We attempt to first parse as a function type,
    // and revert back the state if it fails. Later,
    // tsParsePrimaryType will handle the parenthesized
    // type case.
    const state = this.state.clone();
    try {
      return this.tsParseFunctionType();
    } catch (err) {
      this.state = state;
    }
  }

  return this.tsParseMaybeUnionType();
};

pp.tsParseTypeAlias = function (node) {
  node.id = this.tsParseTypeIdentifier();

  if (this.isRelational("<")) {
    node.typeParameters = this.tsParseTypeParameters();
  } else {
    node.typeParameters = null;
  }

  // XXX: flow: `.right`, ts compiler: `.type`, though
  // typeAnnotation seems like the wrong phrasing.
  this.expect(tt.eq);
  node.typeAnnotation = this.tsParseType();
  this.semicolon();

  return this.finishNode(node, "TypeAlias");
};

pp.tsParseEnum = function() {
  const node = this.startNode();

  if (this.match(tt.name) && this.state.value === "enum") {
    this.next();
  } else {
    this.unexpected();
  }

  node.name = this.tsParseTypeIdentifier();

  node.members = [];
  this.expect(tt.braceL);
  while (!this.match(tt.braceR)) {
    node.members.push(this.tsParseEnumMember());
    if (!this.match(tt.braceR)) {
      this.eat(tt.comma);
    }
  }
  this.expect(tt.braceR);

  return this.finishNode(node, "EnumDeclaration");
};

pp.tsParseEnumMember = function() {
  const node = this.startNode();

  node.name = this.tsParsePropertyName();
  if (node.name.type === "ComputedPropertyName") {
    this.raise(node.name.start, "Enum property name cannot be a computed property");
  }

  if (this.eat(tt.eq)) {
    node.initializer = this.parseMaybeAssign();
  }

  return this.finishNode(node, "EnumMember");
};

export default function (instance) {
  instance.extend("parseExpressionStatement", function(inner) {
    return function(node, expr) {
      if (expr.type === "Identifier") {
        if (this.match(tt.name)) {
          if (expr.name === "interface") {
            return this.tsParseInterface(node);
          } else if (expr.name === "type") {
            return this.tsParseTypeAlias(node);
          }
        }
      }

      return inner.call(this, node, expr);
    };
  });

  // parse ts type annotations on variable declarator heads - let foo: string = bar
  instance.extend("parseVarHead", function(inner) {
    return function(decl) {
      inner.call(this, decl);
      if (this.eat(tt.colon)) {
        // XXX: ts calls this the `type` on the VariableDeclaration,
        // but babylon already uses `type` to mean the node type.
        decl.id.typeAnnotation = this.tsParseType();
        this.finishNode(decl.id, decl.id.type);
      }
    };
  });

  // parse ts enums. Need to override here instead of
  // at parseExpressionStatement because parseExprAtom
  // attempts to parse the identifier (enum) which is a
  // reserved word.
  instance.extend("parseExprAtom", function(inner) {
    return function(refShorthandDefaultPos) {
      if (this.match(tt.name)) {
        if (this.state.value === "enum") {
          return this.tsParseEnum();
        }
      }
      return inner.call(this, refShorthandDefaultPos);
    };
  });

  // parse type parameters for function  decl + expr,
  // i.e. `function compare<T>(x: T): number { ... }`
  instance.extend("parseFunctionParams", function(inner) {
    return function(node) {
      node.typeParameters = null;
      if (this.isRelational("<")) {
        node.typeParameters = this.tsParseTypeParameters();
      }

      inner.call(this, node);
    };
  });

  // parse return types for function  decl + expr
  instance.extend("parseFunctionBody", function(inner) {
    return function(node, allowExpression) {
      if (this.match(tt.colon) && !allowExpression) {
        // if allowExpression is true then we're parsing an arrow function and if
        // there's a return type then it's been handled elsewhere
        node.typeAnnotation = this.flowParseTypeAndPredicateAnnotation();
      }

      return inner.call(this, node, allowExpression);
    };
  });

  // attempt to parse function parameter modifiers,
  // i.e. function s(public x) {}
  instance.extend("parseMaybeDefault", function (inner) {
    return function (...args) {
      const maybeModifierValue = this.state.value;
      if (this.tsIsModifierKeyword()) {
        const modifier = this.startNode();
        this.next();
        const modifiers = [this.finishNode(modifier, modifierMap[maybeModifierValue])];

        const node = inner.apply(this, args);
        node.modifiers = modifiers;
        return node;
      }
      return inner.apply(this, args);
    };
  });

  // parse parameter list type annotations for function decl + expr,
  // i.e. `function s(x: number) { ... }`
  instance.extend("parseAssignableListItemTypes", function() {
    return function(param) {
      if (this.match(tt.question)) {
        const questionNode = this.startNode();
        this.expect(tt.question);
        param.questionToken = this.finishNode(questionNode, "QuestionToken");
      }

      if (this.eat(tt.colon)) {
        param.typeAnnotation = this.tsParseType();
      }

      return this.finishNode(param, param.type);
    };
  });

  // parse type assertions, i.e. var x = <string>y;
  instance.extend("parseMaybeUnary", function(inner) {
    return function(refShorthandDefaultPos) {
      // XXX(TODO): this parsing is not done for .tsx files.
      if (this.isRelational("<")) {
        const node = this.startNode();
        this.next();
        node.typeAnnotation = this.tsParseType();
        this.expectRelational(">");
        node.expression = inner.call(this, refShorthandDefaultPos);
        return this.finishNode(node, "TypeAssertionExpression");
      }

      return inner.call(this, refShorthandDefaultPos);
    };
  });

  // parse type assertion (as expression) as a binary expression,
  // i.e. `var x = 5 as number;`
  // also see: https://github.com/Microsoft/TypeScript/pull/3564/files
  instance.extend("parseExprOp", function(inner) {
    return function(left, leftStartPos, leftStartLoc, minPrec, noIn) {
      const expr = inner.call(this, left, leftStartPos, leftStartLoc, minPrec, noIn);
      if (this.match(tt.name) && this.state.value === "as") {
        const asExpr = this.startNode();
        this.next();
        asExpr.typeAnnotation = this.tsParseType();
        asExpr.expression = expr;
        return this.finishNode(asExpr, "AsExpression");
      }
      return expr;
    };
  });

  instance.extend("parseSubscript", function(inner) {
    return function(base, startPos, startLoc, noCalls) {
      const state = this.state.clone();
      try {
        // Attempt to parse as a call expression with type
        // arguments, but go on if this fails.
        // i.e. class s extends k<X>() vs. class s extends K<T>
        if (!noCalls && this.isRelational("<")) {
          const node = this.startNodeAt(startPos, startLoc);
          node.typeArguments = this.tsParseTypeArgumentList();

          const possibleAsync = (
            this.state.potentialArrowAt === base.start &&
            base.type === "Identifier" &&
            base.name === "async" &&
            !this.canInsertSemicolon()
          );

          this.next();

          node.callee = base;
          node.arguments = this.parseCallExpressionArguments(tt.parenR, possibleAsync);
          if (node.callee.type === "Import" && node.arguments.length !== 1) {
            this.raise(node.start, "import() requires exactly one argument");
          }
          base = this.finishNode(node, "CallExpression");

          if (possibleAsync && this.shouldParseAsyncArrow()) {
            return this.parseAsyncArrowFromCallExpression(this.startNodeAt(startPos, startLoc), node);
          } else {
            this.toReferencedList(node.arguments);
          }
        }
      } catch (err) {
        this.state = state;
      }

      return inner.call(this, base, startPos, startLoc, noCalls);
    };
  });

  // Classes
  instance.extend("parseClassId", function(inner) {
    return function(node) {
      inner.apply(this, arguments);
      if (this.isRelational("<")) {
        node.typeParameters = this.tsParseTypeParameters();
      }
    };
  });

  instance.extend("parseClassSuper", function(inner) {
    return function(node, isStatement) {
      inner.call(this, node, isStatement);
      if (node.superClass && this.isRelational("<")) {
        // XXX: this is what flow does, but not TS compiler.
        // We might want to stick with what flow does here instead of
        // follow ts' HeritageClause, since it lets the rest of the
        // class declaration follow estree a little closer.
        // however... (see below)
        node.superTypeParameters = this.tsParseTypeParameters();
      }

      // this part gets murky because it's not part of
      // estree. Here, we could go back to following ts compiler's
      // heritage clauses, but the asymmetry is unfortunate.
      if (this.isContextual("implements")) {
        this.next();

        const heritageNode = this.startNode();

        const implemented = node.implements = [];
        do {
          const node = this.startNode();
          node.id = this.tsParseTypeIdentifier();
          if (this.isRelational("<")) {
            node.typeParameters = this.tsParseTypeParameters();
          } else {
            node.typeParameters = null;
          }
          implemented.push(this.finishNode(node, "ClassImplements"));
        } while (this.eat(tt.comma));
      }
    };
  });

  instance.extend("maybeParseClassElementModifier", function() {
    return function(node) {
      const maybeModifierValue = this.state.value;
      if (this.tsIsModifierKeyword()) {
        const modifier = this.startNode();
        this.next();
        node.modifiers = [this.finishNode(modifier, modifierMap[maybeModifierValue])];
      }
    }
  });

  instance.extend("parseClassMethod", function(inner) {
    return function(classBody, method, ...args) {
      if (this.isRelational("<")) {
        method.typeParameters = this.tsParseTypeParameters();
      }

      inner.call(this, classBody, method, ...args);
    };
  });

  // also allow type parameters in front of class methods,
  // i.e. `class X { length<T>() {} }`
  instance.extend("isClassMethod", function(inner) {
    return function() {
      return this.isRelational("<") || inner.call(this);
    };
  });
}
