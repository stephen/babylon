import { types as tt } from "../tokenizer/types";
// import { types as ct } from "../tokenizer/context";
import Parser from "../parser";

// XXX: targeting ts1.8 grammar:
// https://github.com/Microsoft/TypeScript/blob/master/doc/spec.md#A
// attempt to copy words/identifiers from flow plugin where possible
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
    node.typeParameters = this.tsParseTypeParameterDeclaration();
  }

  // XXX: handle InterfaceExtendsClause
  node.extends = [];

  // XXX: handle ObjectType
  node.body = null;
  console.log(node);

  return this.finishNode(node, "InterfaceDeclaration");
};

// "TypeParameters" acc. spec
pp.tsParseTypeParameterDeclaration = function() {
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

  return this.finishNode(node, "TypeParameterDeclaration");
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
