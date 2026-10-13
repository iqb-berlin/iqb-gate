export { provideIqbGate, type IqbGateOptions } from './lib/provide-iqb-gate';
export { iqbGateInterceptor, IqbGateInterceptor } from './lib/interceptors/iqb-gate.interceptor';
export {
  gateRefusalOf, isAutomationDetected, isGateRefusal, type GateRefusal
} from './lib/gate-refusal';
export {
  DEFAULT_GATE_TEXTS, IQB_GATE_TEXTS, mergeGateTexts, WIDGET_TEXT_NAMES,
  type GateTexts, type GateTextsOverride, type WidgetTextName
} from './lib/gate-texts';
export { GateInputActivityService } from './lib/services/gate-input-activity.service';
export { GateVerificationService } from './lib/services/gate-verification.service';
export { GateChallengeService } from './lib/services/gate-challenge.service';
export { GateRefusalNoticeService } from './lib/services/gate-refusal-notice.service';
export {
  GateVerificationDialogComponent
} from './lib/components/gate-verification-dialog/gate-verification-dialog.component';
export { GateRefusalDialogComponent } from './lib/components/gate-refusal-dialog/gate-refusal-dialog.component';
export {
  collectClientSignals, detectDevtoolsProtocol, detectSoftwareRenderer, type ObservedInput
} from './lib/utils/client-signals';
export { provideIqbOidc, iqbOidcInterceptors } from './lib/oidc/provide-iqb-oidc';
export { IQB_OIDC_OPTIONS, type IqbOidcOptions } from './lib/oidc/iqb-oidc-options';
export { IqbOidcService, type IqbOidcIdentity } from './lib/oidc/iqb-oidc.service';
export { iqbOidcUnauthorizedInterceptor } from './lib/oidc/iqb-oidc-unauthorized.interceptor';
export { IQB_OIDC_OWN_UNAUTHORIZED } from './lib/oidc/iqb-oidc-options';
