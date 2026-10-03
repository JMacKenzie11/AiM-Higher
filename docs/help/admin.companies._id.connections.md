---
title: Connections
roles: [system_admin, company_admin, aims_guide, portfolio_admin]
---

# Connections

The outside systems AiMS reads for your company. Open it from *Company settings*, on the Connections card. Your company's admins can use this page, and so can the AiMS Guides assigned to your company.

## Google

Google brings in your meeting transcripts from Google Drive, and any measures read from a Google Sheet.

- **Connect Google account** asks you to sign in with Google. AiMS reads with that account, so share your transcript folders and spreadsheets with its address, as a Viewer.
- **Reconnect or switch account** signs in again, with the same account or a different one.
- **Disconnect** stops transcripts and Sheets measures coming in until you connect again.

## HubSpot

HubSpot feeds Critical Success Factors from your deals. AiMS only reads; it never changes anything in HubSpot. You'll see this card when your company has measures from outside systems switched on.

1. In HubSpot, a Super Admin creates a **service key**: Settings → Integrations → Service keys. Give it two read-only scopes: `crm.objects.deals.read` and `crm.schemas.deals.read`.
2. Copy the key and paste it into *HubSpot service key* here, then click *Save key*.
3. AiMS checks the key with HubSpot before saving it. If HubSpot refuses it, or a scope is missing, nothing is saved and the page says what to fix.

**Paste the key here yourself.** Never send a key by email or in a chat, to AiMS or anyone else. Once saved, nobody can see the key again, here or anywhere else; the card shows only its last four characters.

To change keys, paste the new one under *Replace the key*. *Disconnect* deletes the saved key, and measures from HubSpot stop updating until you add one again.

## Common questions

**Why can't I see the HubSpot card?** It appears only when your company has measures from outside systems switched on. Ask AiMS if you'd like it.

**Where did Connect Google account go?** It moved here from the Meeting transcripts card, so every connection is in one place.
