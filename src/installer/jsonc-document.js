import { applyEdits, modify, parse, parseTree, printParseErrorCode } from "jsonc-parser";

const MAX_DEPTH = 50;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class JsoncDocumentError extends Error {
  constructor(message, { code = "OPENCODE_CONFIG_INVALID", cause } = {}) {
    super(message, { cause });
    this.name = "JsoncDocumentError";
    this.code = code;
    this.statusCode = 422;
  }
}

export function parseJsoncDocument(source, { path = "OpenCode config" } = {}) {
  if (typeof source !== "string") {
    throw new TypeError("JSONC source must be a string.");
  }

  const errors = [];
  const value = parse(source, errors, {
    allowEmptyContent: false,
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    const first = errors[0];
    throw new JsoncDocumentError(
      `${path} is not valid JSON or JSONC (${printParseErrorCode(first.error)} at offset ${first.offset}).`,
    );
  }

  const tree = parseTree(source, [], {
    allowEmptyContent: false,
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (!tree || tree.type !== "object" || !isPlainObject(value)) {
    throw new JsoncDocumentError(`${path} must contain one top-level object.`);
  }

  validateObjectTree(tree, path, 0);
  return { tree, value };
}

export function applyJsoncOperations(source, operations, formattingOptions = {}) {
  let next = source;
  for (const operation of operations) {
    const value = operation.action === "remove" ? undefined : operation.value;
    const edits = modify(next, operation.path, value, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
        eol: detectEol(next),
        ...formattingOptions,
      },
    });
    next = applyEdits(next, edits);
  }
  parseJsoncDocument(next);
  return ensureFinalNewline(next);
}

export function valueAtPath(root, path) {
  let current = root;
  for (const segment of path) {
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
      return { exists: false, value: undefined };
    }
    current = current[segment];
  }
  return { exists: true, value: current };
}

function validateObjectTree(node, path, depth) {
  if (depth > MAX_DEPTH) {
    throw new JsoncDocumentError(`${path} exceeds the supported nesting depth.`);
  }

  if (node.type === "object") {
    const seen = new Set();
    for (const property of node.children ?? []) {
      const [keyNode, valueNode] = property.children ?? [];
      const key = keyNode?.value;
      if (typeof key !== "string" || !valueNode) {
        throw new JsoncDocumentError(`${path} contains an invalid property.`);
      }
      if (UNSAFE_KEYS.has(key)) {
        throw new JsoncDocumentError(`${path} contains unsafe key ${key}.`);
      }
      if (seen.has(key)) {
        throw new JsoncDocumentError(`${path} contains duplicate key ${key}.`);
      }
      seen.add(key);
      validateObjectTree(valueNode, `${path}.${key}`, depth + 1);
    }
    return;
  }

  if (node.type === "array") {
    for (const [index, child] of (node.children ?? []).entries()) {
      validateObjectTree(child, `${path}[${index}]`, depth + 1);
    }
  }
}

function detectEol(source) {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function ensureFinalNewline(source) {
  if (source.endsWith("\r\n") || source.endsWith("\n")) return source;
  return `${source}${detectEol(source)}`;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
