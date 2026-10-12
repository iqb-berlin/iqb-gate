import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  Component, inject, OnDestroy, signal
} from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { Subject, takeUntil } from 'rxjs';
import { isAutomationDetected, IqbOidcService } from '@iqb/gate-angular';

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
  imports: [AsyncPipe, FormsModule, MatButton]
})
export class AppComponent implements OnDestroy {
  private readonly http = inject(HttpClient);
  readonly oidc = inject(IqbOidcService);
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
      error: (error: HttpErrorResponse) => this.status.set(`Laden fehlgeschlagen (${error.status}).`)
    });
  }

  save(): void {
    this.status.set('Speichere …');
    this.http.patch<Note>('/api/notes', { text: this.text }).pipe(takeUntil(this.ngUnsubscribe)).subscribe({
      next: note => {
        this.note.set(note);
        this.status.set(`Gespeichert von ${note.by}.`);
      },
      error: (error: unknown) => {
        if (isAutomationDetected(error)) {
          this.status.set('Abgelehnt: Der Browser meldet sich als automatisiert.');
        } else {
          this.status.set(`Nicht gespeichert (${error instanceof HttpErrorResponse ? error.status : 'Fehler'}).`);
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }
}
