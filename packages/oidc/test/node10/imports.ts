// What a NestJS backend with `"module": "commonjs"` sees: moduleResolution node10 ignores `exports`.
// Checks the built dist, as an application gets it: the root's typecheck builds the package first.
import { OidcVerifier } from '@iqb/gate-oidc';
import { FakeProvider } from '@iqb/gate-oidc/testing';

export const provider: FakeProvider = new FakeProvider();
export const verifier: OidcVerifier = new OidcVerifier({ issuer: provider.issuer, clientId: 'studio' });
