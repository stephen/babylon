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
pp.tsParseTypeName = function() {
  let node = this.parseIdentifier();

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
}

pp.tsParseType = function() {
  const node = this.startNode();
  // should handle...
  //     Type:
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
  //    ThisType
  //
  //   ParenthesizedType:
  //    ( Type )
  this.next(); // skip it? this will fail for anything more complex than a name
  return this.finishNode(node, "SomeTypeAnnotation")
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
}
