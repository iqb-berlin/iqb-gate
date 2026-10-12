import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  iqbGateInterceptor, iqbOidcInterceptors, provideIqbGate, provideIqbOidc
} from '@iqb/gate-angular';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter([]),
    provideIqbOidc({
      issuer: 'http://localhost:8180/realms/iqb-demo',
      clientId: 'iqb-gate-demo',
      apiUrls: ['/api/']
    }),
    provideIqbGate(),
    provideHttpClient(withInterceptors([...iqbOidcInterceptors(), iqbGateInterceptor]))
  ]
}).catch(error => console.error(error));
