import { Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { type GateTexts, IQB_GATE_TEXTS } from '../../gate-texts';
import type { GateRefusal } from '../../gate-refusal';

/**
 * Tells the person that the gateway did not let a request through, and why. A dialog, not a snack
 * bar: an application's own message about the failed request ("login failed") would replace a snack
 * bar before it could be read. Opened by `GateRefusalNoticeService`.
 */
@Component({
  selector: 'iqb-gate-refusal-dialog',
  templateUrl: './gate-refusal-dialog.component.html',
  styleUrls: ['./gate-refusal-dialog.component.scss'],
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButton]
})
export class GateRefusalDialogComponent {
  private readonly refusal: GateRefusal = inject(MAT_DIALOG_DATA);
  readonly texts: GateTexts = inject(IQB_GATE_TEXTS)();
  readonly message = this.refusal === 'automation-detected' ? this.texts.automationDetected : this.texts.notVerified;
}
