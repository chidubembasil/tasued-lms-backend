import { Injectable } from '@nestjs/common';
import { ClientSecretCredential } from '@azure/identity';

@Injectable()
export class GraphService {
  private credential?: ClientSecretCredential;

  // created on first use so the app still boots if the Azure env vars are not set yet
  private getCredential() {
    if (!this.credential) {
      const tenantId = process.env.AZURE_TENANT_ID;
      const clientId = process.env.AZURE_CLIENT_ID;
      const clientSecret = process.env.AZURE_CLIENT_SECRET;

      if (!tenantId || !clientId || !clientSecret) {
        throw new Error(
          'AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET must be set',
        );
      }

      this.credential = new ClientSecretCredential(
        tenantId,
        clientId,
        clientSecret,
      );
    }
    return this.credential;
  }

  private async request(
    path: string,
    init: RequestInit,
    attempt = 0,
  ): Promise<any> {
    const { token } = await this.getCredential().getToken(
      'https://graph.microsoft.com/.default',
    );

    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    // Graph throttling: wait the time it asks for, then retry
    if (res.status === 429 && attempt < 4) {
      const waitSeconds = Number(res.headers.get('Retry-After') ?? 5);
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      return this.request(path, init, attempt + 1);
    }

    if (!res.ok) {
      throw new Error(`Graph ${res.status}: ${await res.text()}`);
    }

    return res.json();
  }

  // Needs the User.Invite.All application permission with admin consent.
  async inviteGuest(
    email: string,
    displayName: string,
  ): Promise<{ guestObjectId: string }> {
    const data = await this.request('/invitations', {
      method: 'POST',
      body: JSON.stringify({
        invitedUserEmailAddress: email,
        invitedUserDisplayName: displayName,
        inviteRedirectUrl: process.env.APP_URL ?? 'https://teams.microsoft.com',
        sendInvitationMessage: false, // our own welcome email goes out instead
      }),
    });

    return { guestObjectId: data.invitedUser.id as string };
  }
}