import type { FieldIssue } from "@/shared/errors";

export interface CountryRulesInput {
  phonePattern: string;
  documentTypes: readonly string[];
  idNumberPatterns: readonly { documentType: string; pattern: string }[];
}

const compiles = (pattern: string) => {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
};

// The issues of a country input, each on its path. `documentKeys` are the
// keys of the live document categories: a country offers those and no other.
export function countryIssues(
  input: CountryRulesInput,
  documentKeys: ReadonlySet<string>,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!compiles(input.phonePattern)) {
    issues.push({
      path: "phonePattern",
      code: "validation.errors.invalid-format",
    });
  }
  input.documentTypes.forEach((key, i) => {
    if (!documentKeys.has(key)) {
      issues.push({
        path: `documentTypes.${i}`,
        code: "config.errors.document-type-unknown",
        params: { key },
      });
    }
  });
  input.idNumberPatterns.forEach((entry, i) => {
    if (!compiles(entry.pattern)) {
      issues.push({
        path: `idNumberPatterns.${i}.pattern`,
        code: "validation.errors.invalid-format",
      });
    }
    if (!input.documentTypes.includes(entry.documentType)) {
      issues.push({
        path: `idNumberPatterns.${i}.documentType`,
        code: "config.errors.document-type-unknown",
        params: { key: entry.documentType },
      });
    }
  });
  return issues;
}

export interface CategoryRulesInput {
  key: string;
  parent: string | null | undefined;
  isDocument: boolean;
}

// The issues of a category input. The tree has two levels: a parent is a root
// (it has no parent itself), a category that has children cannot take a
// parent, and a child is a document exactly when its parent is.
export function categoryIssues(
  input: CategoryRulesInput,
  parent: { parent: string | null; isDocument: boolean } | undefined,
  hasChildren: boolean,
): FieldIssue[] {
  if (input.parent === null || input.parent === undefined) return [];
  const invalid = (reason: string): FieldIssue => ({
    path: "parent",
    code: "config.errors.category-parent-invalid",
    params: { parent: input.parent as string, reason },
  });
  if (input.parent === input.key) return [invalid("self")];
  if (parent === undefined) return [invalid("unknown")];
  if (parent.parent !== null) return [invalid("notroot")];
  if (hasChildren) return [invalid("haschildren")];
  if (parent.isDocument !== input.isDocument) return [invalid("document")];
  return [];
}
