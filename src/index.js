import Parser, { plugins } from "./parser";
import "./parser/util";
import "./parser/statement";
import "./parser/lval";
import "./parser/expression";
import "./parser/node";
import "./parser/location";
import "./parser/comments";

import { types as tokTypes } from "./tokenizer/types";
import "./tokenizer";
import "./tokenizer/context";

import estreePlugin from "./plugins/estree";
import flowPlugin from "./plugins/flow";
import jsxPlugin from "./plugins/jsx";
import typescriptPlugin from "./plugins/typescript";
plugins.estree = estreePlugin;
plugins.flow = flowPlugin;
plugins.jsx = jsxPlugin;
plugins.typescript = typescriptPlugin;

export function parse(input, options) {
  return new Parser(options, input).parse();
}

export function parseExpression(input, options) {
  const parser = new Parser(options, input);
  if (parser.options.strictMode) {
    parser.state.strict = true;
  }
  return parser.getExpression();
}


export { tokTypes };
