import {
  Body, Controller, Get, Patch, UseGuards
} from '@nestjs/common';
import { OidcAuthGuard, OidcIdentity, type OidcIdentityData } from '@iqb/gate-nest';

interface Note {
  text: string;
  by: string | null;
  at: string | null;
}

/** One note, kept in memory: readable and writable for whoever the provider's token names. */
@Controller('api/notes')
@UseGuards(OidcAuthGuard)
export class NotesController {
  private note: Note = { text: '', by: null, at: null };

  @Get()
  read(): Note {
    return this.note;
  }

  @Patch()
  save(@Body() body: { text?: unknown }, @OidcIdentity() identity: OidcIdentityData): Note {
    this.note = {
      text: typeof body?.text === 'string' ? body.text.slice(0, 2000) : '',
      by: identity.username,
      at: new Date().toISOString()
    };
    return this.note;
  }
}
