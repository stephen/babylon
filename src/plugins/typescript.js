import { types as tt } from "../tokenizer/types";
// import { types as ct } from "../tokenizer/context";
import Parser from "../parser";

// XXX: targeting ts1.8 grammar:
// https://github.com/Microsoft/TypeScript/blob/master/doc/spec.md#A
// attempt to copy words/identifiers from flow plugin where possible
// also see https://github.com/babel/babylon/issues/320
const pp = Parser.prototype;

// pp.tsParseDeclareInterface = function (node) {
//   this.next();
//   this.flowParseInterfaceish(node);
//   return this.finishNode(node, "DeclareInterface");
// };
//

pp.tsParseInterface = function(node) {
  //  InterfaceDeclaration:
  //    interface BindingIdentifier TypeParametersopt InterfaceExtendsClauseopt ObjectType
  //
  //   InterfaceExtendsClause:
  //    extends ClassOrInterfaceTypeList
  //
  //   ClassOrInterfaceTypeList:
  //    ClassOrInterfaceType
  //    ClassOrInterfaceTypeList , ClassOrInterfaceType
  //
  //   ClassOrInterfaceType:
  //    TypeReference

  node.id = this.parseIdentifier();

  // XXX: handle generics (TypeParameters), i.e. interface<T> A { ... }
  node.typeParameters = null;
  if (this.isRelational("<")) {
    node.typeParameters = this.tsParseTypeParameterList();
  }

  // XXX: handle InterfaceExtendsClause
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
// valid typescript. type names.
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
pp.tsParseTypeParameterList = function() {
  // XXX: inType?
  const node = this.startNode();
  node.params = [];

  this.expectRelational("<");
  do {
    node.params.push(this.tsParseTypeParameter());
    if (!this.isRelational(">")) {
      this.expect(tt.comma);
    }
  } while (!this.isRelational(">"));
  this.expectRelational(">");

  return this.finishNode(node, "TypeParameterList");
};

const strictModeReservedWords = [
  "implements",
  "interface",
  "let",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "yield",
];

const typeIdentifierReservedWords = [
  "any",
  "boolean",
  "number",
  "string",
  "symbol",
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

  // XXX: flow calls this bounded polymorphism
  // https://github.com/Microsoft/TypeScript/blob/master/doc/spec.md#7
  // and the flow plugin calls this .typeAnnotation.
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

  // flow splits this into callProperties, properties, and indexers, but
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
    }
  }
  this.expect(tt.braceR);

  // XXX: ObjectTypeAnnotation
  return this.finishNode(nodeStart, "TypeLiteral");
};

pp.tsParseObjectTypeIndexSignature = function() {
  const node = this.startNode();
  node.parameters = [];

  const paramNode = this.startNode();

  this.expect(tt.bracketL);
  // XXX: flow calls this id / key
  paramNode.name = this.parseIdentifier();
  this.expect(tt.colon);

  // XXX: ts compiler calls this `type`, but
  // babylon uses type to mean the node's type.
  // `key` is the flow terminology. (this is also
  // inconsistent with `typeAnnotation` below...)
  paramNode.key = this.tsParseType();
  if (["StringKeyword", "NumberKeyword"].indexOf(paramNode.key.type) === -1) {
    this.raise(paramNode.key.start, "Object indexer can only have string or number type");
  }

  // XXX: flow does not have this level of indirection. the parameters live
  // directly on the ObjectTypeIndexed as id / key / value
  node.parameters.push(this.finishNode(paramNode, "Parameter"));
  this.expect(tt.bracketR);
  this.expect(tt.colon); // XXX: flow handles this with flowParseTypeInitialiser

  // XXX: again, ts calls this `type`, but that overloads the word
  // in babylon. flow calls this `value`
  node.value = this.tsParseType();

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

pp.tsParsePrimaryType = function() {
  const node = this.startNode();
  switch (this.state.type) {
    case tt.name:
      const identifier = this.parseIdentifier();
      return this.tsParsePredefinedType(node, identifier) || this.tsParseTypeReference(node, identifier);
    case tt.braceL:
      return this.tsParseObjectType();
  }
};

pp.tsParseType = function() {
  return this.tsParsePrimaryType();
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
  //    ParenthesizedType
  //    PredefinedType
  //    TypeReference
  //    ObjectType
  //    ArrayType
  //    TupleType
  //    TypeQuery
  //
  //   ParenthesizedType:
  //    ( Type )
}

export default function (instance) {
  instance.extend("parseExpressionStatement", function (inner) {
    return function(node, expr) {
      if (expr.type === "Identifier") {
        if (this.match(tt.name)) {
          if (expr.name === "interface") {
            return this.tsParseInterface(node);
          }
        }
      }

      return inner.call(this, node, expr);
    };
  });

  // parse flow type annotations on variable declarator heads - let foo: string = bar
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
