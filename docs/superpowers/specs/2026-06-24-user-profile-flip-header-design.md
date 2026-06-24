# User Profile — Flip-Header — Design Spec

**Date:** 2026-06-24
**Status:** Approved by operator (design). Implementation NOT started — pending plan + go.

## Goal

Give each Zeus user a personal, social profile (photo, name, @username, accent colour, tagline)
that they can set themselves, surfaced through a delightful **3D-flip header**: clicking the
Zeus logo flips the top bar over to reveal an editable profile panel styled exactly like the
existing header; clicking the avatar flips it back. The existing trading header stays 100%
untouched — it is simply the "front" of the flip; the profile is the "back".

## The interaction (the heart of it)

- **Front** = the current top header, unchanged. The Zeus logo (`⚡ZEUS`) becomes the flip trigger.
- Click `⚡ZEUS` → the header does a 3D flip (rotateX, "over the top", ~0.5s) → the **profile panel** appears.
- **Profile panel** = same visual style as the header (so it never looks out of place). Where the
  Zeus logo was, the user's **avatar + "upload photo"** appears; beside it the username/name/tagline,
  plus an accent-colour pick.
- **Editing each field** opens a clean dedicated input dialog (reuse the existing `appConfirm` input
  modal): tap a field (name / @username / tagline) or the avatar → a box opens → type → **OK/confirm**
  → it saves. Username uniqueness is checked server-side before confirm succeeds.
- Click the **avatar** → flips back to the normal header.
- It is a panel (not a one-line bar), so there is room for all fields.

```
 click ⚡ZEUS  →  flip ↻  →  PROFILE PANEL (header style)
 ┌────────────────────────────────────────────┐
 │ (◕ upload)  Ovi ⚡   @zeus_ovi      [Save]   │
 │  your photo  "Hunting liquidations ⚡"   🎨   │   ← click avatar = flip back
 └────────────────────────────────────────────┘
```

## Profile fields

| Field | Notes |
|---|---|
| `avatar` | User uploads a photo; the browser **re-encodes it through a canvas** (draw → re-export as clean PNG/JPEG), cropped square + resized to ~128px. The canvas re-encode keeps ONLY pixels and discards everything else attached to the file (EXIF/metadata, any embedded script, "polyglot" malware-in-image), so the uploaded image is sterile. Stored small (base64) in the DB. Fallback when unset: a coloured circle with initials. |
| `display_name` | Free text, short (e.g. "Ovi ⚡"). |
| `username` | Unique handle, shown as `@name`. Validated (allowed chars, length), uniqueness checked server-side. |
| `accent_color` | A colour the user picks; shows on the avatar ring / name. |
| `tagline` | Short one-liner (e.g. "Hunting liquidations ⚡"). |

Explicitly **out of scope (YAGNI):** trader-stats badge (operator declined).

## Where the profile shows (visibility = social, small trusted user group)

- **Phase 1 (this spec):** the flip panel (view + edit) + the user's own surfaces — replace the small
  email in the header with avatar+name (on the front, optional), and OMEGA can greet by name.
- **Phase 2 (separate spec/plan):** social surfaces — avatars + names on the leaderboard, in the
  admin user list, and in support chat. These reuse the same public-profile read endpoint.

## Data flow & storage

- **Edit/save:** browser validates (image only) + resizes the avatar to ~128px (canvas → base64),
  then `POST /api/profile` with `{ display_name, username, accent_color, tagline, avatar }`.
- **Server:** validates each field against a schema (image size cap, username regex + uniqueness,
  colour format, length caps), then upserts. **Both the route whitelist AND the validator schema
  must list every new key** (lesson from the indicators bug: an unknown key is otherwise dropped or
  the whole save is rejected 400).
- **Storage:** new profile fields live on the **`users` table** (new columns: `display_name`,
  `username`, `avatar`, `accent_color`, `tagline`) — NOT in `user_settings`, because the profile must
  be readable across users for the social phase, whereas `user_settings` is a private per-user blob.
  Avatar kept small (base64, capped) so no filesystem paths / no new file-serving surface.
- **Read (for display + Phase 2 social):** `GET /api/profile/:userId` (or batch) returns ONLY public
  fields (`display_name, username, accent_color, tagline, avatar`) — never email or anything sensitive.

## Security / privacy

- Only public fields are ever exposed to other users; email and account data stay private.
- **Avatar "virus" defence (operator concern):** the browser re-encodes the image through a canvas
  before upload, which strips EXIF/metadata and any embedded payload (malware-in-image / polyglot
  files cannot survive a pixels-only re-export). Server then validates it is a real image (magic
  bytes, not just extension), enforces a hard byte-size cap AND a max-dimension cap, and only accepts
  PNG/JPEG/WebP. Base64 in DB, so no filesystem path / no new file-serving endpoint to attack.
- Username validated (charset + length) and unique; reserved/admin-impersonating handles rejected.

## Components (Phase 1)

1. **Header flip container** — wraps the existing header (front) + a new profile panel (back) with a
   CSS 3D flip; click handlers on the Zeus logo (to profile) and the avatar (back).
2. **Profile panel** — header-styled, inline-editable: avatar+upload, display name, @username,
   accent picker, tagline, Save. Avatar uses the initials fallback when unset.
3. **Avatar helper** — client-side crop+resize to ~128px + base64 encode; initials-circle generator.
4. **Profile store/state** — load the user's profile on boot; hold edits; call save.
5. **Server `/api/profile`** — POST (validated + whitelisted upsert) and GET (public fields only),
   plus the storage migration for the new fields.

## Testing

- Unit: avatar resize/encode produces a small valid image; initials generator; username validator
  (valid/invalid/duplicate); profile payload validator (accepts new keys, rejects bad types/oversize).
- Integration: POST then GET round-trips all fields; GET never leaks email; oversized avatar rejected.
- Manual/live: click logo → flip to profile → edit + save → reload → values persist + render; click
  avatar → flip back; front header unchanged.

## Phasing

- **Phase 1:** everything above — profile + flip + edit + the user's own display. Ship this first.
- **Phase 2 (later, its own plan):** social surfaces (leaderboard/admin/support avatars, OMEGA greeting
  by name) reusing the public-profile read endpoint.
- **Phase 3 (future, its own spec — operator idea):** referral system. Each user gets a unique referral
  code (e.g. `ZEUS-OVI-7K2`); new sign-ups using it are linked to the inviter ("invited by X"). Ties
  naturally into Zeus's existing invite/approval flow. Benefits to be decided by the operator (ideas:
  an "Inviter" badge + invite count on the profile, faster/auto approval for invited users, or a small
  feature unlock). Kept separate so the profile MVP ships clean first.
