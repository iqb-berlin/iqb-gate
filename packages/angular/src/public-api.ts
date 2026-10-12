export { provideIqbGate, type IqbGateOptions } from './lib/provide-iqb-gate';
export { iqbGateInterceptor, IqbGateInterceptor } from './lib/interceptors/iqb-gate.interceptor';
export { isAutomationDetected } from './lib/automation-detected';
export {
  DEFAULT_GATE_TEXTS, IQB_GATE_TEXTS, mergeGateTexts, WIDGET_TEXT_NAMES,
  type GateTexts, type GateTextsOverride, type WidgetTextName
} from './lib/gate-texts';
export { GateInputActivityService } from './lib/services/gate-input-activity.service';
export { GateVerificationService } from './lib/services/gate-verification.service';
export { GateChallengeService } from './lib/services/gate-challenge.service';
export {
  GateVerificationDialogComponent
} from './lib/components/gate-verification-dialog/gate-verification-dialog.component';
export {
  collectClientSignals, detectDevtoolsProtocol, detectSoftwareRenderer, type ObservedInput
} from './lib/utils/client-signals';
