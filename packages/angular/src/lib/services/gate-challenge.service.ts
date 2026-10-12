import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  catchError, map, type Observable, of
} from 'rxjs';
import { CHALLENGE_PATH, type HumanVerificationChallenge, VERIFY_PATH } from '@iqb/gate-protocol';

/** Talks to the gateway about the challenge: fetches one, hands in its solution. */
@Injectable({
  providedIn: 'root'
})
export class GateChallengeService {
  private readonly http = inject(HttpClient);

  /** A new challenge for the ALTCHA widget; `null` when none could be fetched. */
  challenge(): Observable<HumanVerificationChallenge | null> {
    return this.http.get<HumanVerificationChallenge>(CHALLENGE_PATH).pipe(catchError(() => of(null)));
  }

  /** Whether the gateway accepted the solution, and the session may now write. */
  verify(payload: string): Observable<boolean> {
    return this.http.post(VERIFY_PATH, { payload }).pipe(
      map(() => true),
      catchError(() => of(false))
    );
  }
}
