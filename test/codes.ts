// The `extensions.code` of the first error of a GraphQL result, or undefined:
// a spec asserts the code, never the message.
export const codeOf = (result: {
  errors?: readonly { extensions?: { code?: string } }[];
}) => result.errors?.[0]?.extensions?.code;
