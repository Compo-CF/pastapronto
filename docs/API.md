# API (superseded)

This file described the REST API of the original Node implementation:
`GET /api/bootstrap`, `POST /api/orders`, `GET /api/stream` and friends.

**None of it exists any more.** The app was converted to a static site talking
to Firestore directly, so there is no server and no HTTP API. Nothing in the
codebase calls these endpoints.

Where to look instead:

| You want | Read |
| --- | --- |
| How the pieces fit together now | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Collections, documents, security rules | [DATA-MODEL.md](DATA-MODEL.md) |
| Each screen and its states | [SCREENS.md](SCREENS.md) |
| The data-layer functions that replaced the endpoints | `app/db.js` |

The REST version is preserved in git history at commit `36fb976` if you ever
need to compare.

This file is kept only as a signpost. It should go along with the orphaned
`server.js`, `lib/` and `public/` trees:

```bash
git rm -r lib public seed server.js docs/API.md
```
