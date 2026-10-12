import { Module } from '@nestjs/common';
import { IqbOidcModule } from '@iqb/gate-nest';
import { NotesController } from './notes.controller';

@Module({
  imports: [
    IqbOidcModule.forRoot({
      // The same issuer as in ../gate.yaml and ../demo/src/main.ts -- all three have to agree
      issuer: 'http://localhost:8180/realms/iqb-demo',
      clientId: 'iqb-gate-demo',
      // The demo's users: whoever holds the realm role editor; everyone else gets 403
      userSync: { sync: identity => (identity.roles.includes('editor') ? { name: identity.username } : null) }
    })
  ],
  controllers: [NotesController]
})
export class AppModule {}
