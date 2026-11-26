# Roadmap

A direction, not a commitment: entries carry no dates. The issues are the detail; the
tracking issue lists the v1 slices.

## Now

- **v1: lost & found for documents and objects, Cameroon first** (integration branch
  `feat/v1`). People and organisations get:
  - search and a map open to everyone, "around me", and filters by kind, category,
    place and date;
  - accounts verified by phone (SMS code), with e-mail as a fallback;
  - lost and found declarations with photos, a suggested description for objects, and
    ID documents blurred with their number masked, processed on the server only;
  - automatic matching scored on category, place, date and text, both sides notified,
    and saved alerts such as "a CNI found under my name";
  - claims with proof of ownership (questions, last digits, selfie);
  - a masked chat with scam guards, a suggested safe place, a 6-digit handover code
    and reviews;
  - verified organisation spaces with members, a register of deposited items and a
    public page;
  - moderation: reports, org verification, suspensions, a trust score and an audit log;
  - a loss receipt anyone can verify and a shareable poster;
  - listings that expire after 90 days, unclaimed ID documents flagged after 30 days,
    and ID photos deleted when a listing closes.

## Next

- SMS and WhatsApp alerts.
- A sweep that embeds the listings published while the embedder was down, and a
  per-account limit on photo suggestions.
- More countries of francophone Africa, by configuration.

## Later

- **v2: money**: mobile-money rewards and paid organisation plans.

## Not planned

- Sending ID document photos to any remote service.
- Face recognition.

## Shipped

Nothing yet.
