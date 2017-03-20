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

  // XXX: handle ObjectType
  node.body = null;
  console.log(node);

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
  if (this.isContextual("extends")) {
    this.next();
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

pp.tsParseObjectType = function() {
  // XXX: inType?

  const nodeStart = this.startNode();
  this.expect(tt.braceL);

  // flow splits this into callProperties, properties, and indexers.
  // the TS compiler puts them into a single property
  nodeStart.members = [];

  // PropertySignature `name?: TypeAnnotation`
  // CallSignature `<A, B>(a, b): T`
  // ConstructSignature `new <A, B>(a, b) T`
  // IndexSignature `[name: string]: number`
  // MethodSignature `name?: CallSignature`
  while (!this.match(tt.braceR)) {
    if (this.match(tt.bracketL)) {
      nodeStart.members.push(this.tsParseObjectTypeIndexSignature());
    } else if (this.match(tt._new)) {
      nodeStart.members.push(this.tsParseObjectTypeConstructorSignature());
      break;
    }
  }
  this.expect(tt.braceR);

  // XXX: ObjectTypeAnnotation
  return this.finishNode(nodeStart, "TypeLiteral");
};

pp.tsParseObjectTypeConstructorSignature = function() {
  const node = this.startNode();
  this.expect(tt._new);

  // looks like: new <A, B>(A, c): B;
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
  if (["StringKeyword", "NumberKeyword"].indexOf(paramNode.key.type) === -1) {
    this.raise(paramNode.key.start, "Object indexer can only have string or number type");
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

pp.tsParseParameter = function() {
  const node = this.startNode();

  node.modifiers = null;
  if (this.match(tt.name) && modifierMap[this.state.value]) {
    const modifier = this.startNode();
    this.next();
    node.modifiers = [this.finishNode(modifier, modifierMap[this.state.value])];
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
// TypeParametersopt (ParameterList) => Type
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

pp.tsParseType = function() {
  if (this.match(tt._new)) {
    return this.tsParseConstructorType();
  } else if (this.match(tt.parenL) || this.isRelational("<")) {
    return this.tsParseFunctionType();
  }

  return this.tsParseMaybeArrayType();
  // should handle...
  //   Type:
  //    UnionOrIntersectionOrPrimaryType
  //    FunctionType
  //    ConstructorType
  //
  //   UnionOrIntersectionOrPrimaryType:
  //    UnionType
  //    IntersectionOrPrimaryType
  //
  //   IntersectionOrPrimaryType:
  //    IntersectionType
  //    PrimaryType
  //
  //   PrimaryType:
  //    ParenthesizedType - not done
  //    PredefinedType - done
  //    TypeReference - done
  //    ObjectType - not done
  //    ArrayType - done
  //    TupleType - done
  //    TypeQuery - done
  //    ThisType - done
  //
  //   ParenthesizedType:
  //    ( Type )
}

pp.tsParseTypeAlias = function (node) {
  node.id = this.tsParseTypeIdentifier();

  if (this.isRelational("<")) {
    node.typeParameters = this.tsParseTypeParameters();
  } else {
    node.typeParameters = null;
  }

  // XXX: flow: `.right`, ts compiler: `.typeAnnotation`, though
  // typeAnnotation seems like the wrong phrasing.
  this.expect(tt.eq);
  node.typeAnnotation = this.tsParseType();
  this.semicolon();

  return this.finishNode(node, "TypeAlias");
};

export default function (instance) {
  instance.extend("parseExpressionStatement", function (inner) {
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
  instance.extend("parseVarHead", function (inner) {
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
}
