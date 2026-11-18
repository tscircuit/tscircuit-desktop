import * as Schema from "effect/Schema";

const Id = Schema.Int.check(Schema.isGreaterThan(0));
const Text = Schema.String.check(Schema.isMaxLength(512));
const Quantities = Schema.Array(Id.check(Schema.isLessThanOrEqualTo(100_000))).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(12),
);
const Files = Schema.Array(
  Schema.Struct({
    filename: Text,
    content: Schema.String.check(Schema.isMaxLength(20_000_000)),
  }),
).check(Schema.isMinLength(3), Schema.isMaxLength(100));

export const CircuithubRequest = Schema.Union([
  Schema.Struct({ action: Schema.Literals(["status", "login", "logout", "cancel"]) }),
  Schema.Struct({
    action: Schema.Literal("create"),
    workspace: Text,
    projectName: Text,
    exportClassification: Text,
    projectId: Schema.NullOr(Id),
    quantities: Quantities,
    files: Files,
  }),
  Schema.Struct({
    action: Schema.Literal("refresh"),
    projectId: Id,
    revisionId: Id,
    quantities: Quantities,
  }),
]);
export type CircuithubRequest = typeof CircuithubRequest.Type;

export const CircuithubAccount = Schema.Struct({
  connected: Schema.Boolean,
  displayName: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
  loginPending: Schema.Boolean,
  persistent: Schema.Boolean,
  progress: Schema.NullOr(Schema.String),
});
export type CircuithubAccount = typeof CircuithubAccount.Type;

export const CircuithubQuoteResult = Schema.Struct({
  projectId: Id,
  revisionId: Id,
  camReady: Schema.Boolean,
  quotes: Schema.Array(
    Schema.Struct({
      id: Id,
      quantity: Id,
      currency: Schema.String,
      status: Schema.String,
      orderable: Schema.Boolean,
      offers: Schema.Array(
        Schema.Struct({
          id: Id,
          service: Schema.String,
          checkoutUrl: Schema.NullOr(Schema.String),
          total: Schema.String,
          unitPrice: Schema.NullOr(Schema.String),
          ships: Schema.NullOr(Schema.String),
        }),
      ),
      blockers: Schema.Array(Schema.String),
    }),
  ),
  unresolvedParts: Schema.Array(Schema.String),
});
export type CircuithubQuoteResult = typeof CircuithubQuoteResult.Type;

export const CircuithubResponse = Schema.Struct({
  ok: Schema.Boolean,
  account: CircuithubAccount,
  quote: Schema.NullOr(CircuithubQuoteResult),
  error: Schema.NullOr(Schema.String),
});
export type CircuithubResponse = typeof CircuithubResponse.Type;

// A pasted callback contains a credential; keep it redacted inside the HTTP API.
export const CircuithubBrowserRequest = Schema.Union([
  CircuithubRequest,
  Schema.Struct({
    action: Schema.Literal("complete_login"),
    callbackUrl: Schema.RedactedFromValue(Schema.String),
  }),
]);
export type CircuithubBrowserRequest = typeof CircuithubBrowserRequest.Type;
export const CircuithubBrowserResponse = Schema.Struct({
  ...CircuithubResponse.fields,
  authorizationUrl: Schema.NullOr(Schema.String),
});
export type CircuithubBrowserResponse = typeof CircuithubBrowserResponse.Type;
