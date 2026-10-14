import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  Component, computed, inject, OnDestroy, signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { Subject, takeUntil } from 'rxjs';
import { isGateRefusal, IqbOidcService } from '@iqb/gate-angular';

interface Note {
  text: string;
  by: string | null;
  at: string | null;
}

/**
 * The demo: log in with Keycloak, read the note, save it -- the first save of the session asks for
 * the ALTCHA challenge, and the gateway's audit log names the writer as checked.
 */
@Component({
  selector: 'iqb-demo-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  imports: [FormsModule, MatButton]
})
export class AppComponent implements OnDestroy {
  private readonly http = inject(HttpClient);
  readonly oidc = inject(IqbOidcService);
  readonly identity = toSignal(this.oidc.identity$, { initialValue: null });
  /** The roles as the page names them, worked out when the identity changes, not with every check. */
  readonly roles = computed(() => this.identity()?.roles.join(', ') ?? '');
  readonly note = signal<Note | null>(null);
  readonly status = signal('');
  text = '';
  private ngUnsubscribe = new Subject<void>();

  constructor() {
    this.oidc.isAuthenticated$.pipe(takeUntil(this.ngUnsubscribe)).subscribe(authenticated => {
      if (authenticated) this.load();
    });
  }

  load(): void {
    this.http.get<Note>('/api/notes').pipe(takeUntil(this.ngUnsubscribe)).subscribe({
      next: note => {
        this.note.set(note);
        this.text = note.text;
      },
      error: (error: HttpErrorResponse) => this.reportError('Laden fehlgeschlagen', error)
    });
  }

  save(): void {
    this.status.set('Speichere …');
    this.http.patch<Note>('/api/notes', { text: this.text }).pipe(takeUntil(this.ngUnsubscribe)).subscribe({
      next: note => {
        this.note.set(note);
        this.status.set(`Gespeichert von ${note.by}.`);
      },
      error: (error: unknown) => this.reportError('Nicht gespeichert', error)
    });
  }

  /**
   * Says what went wrong -- unless the gateway refused the request: the library has told the person
   * why already, or they cancelled the challenge themselves.
   */
  private reportError(what: string, error: unknown): void {
    if (isGateRefusal(error)) {
      this.status.set('');
      return;
    }
    this.status.set(`${what} (${error instanceof HttpErrorResponse ? error.status : 'Fehler'}).`);
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
