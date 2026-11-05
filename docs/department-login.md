# Department login

The application opens the selected **Guided Path (08)** department selector. Choose Sales, Purchasing, or Warehouse; the selected icon moves first to the center axis and then into place. The password form appears after the movement finishes, on the same page.

The screen uses a white/blue palette with no Bubble background, outer password card, or progress-text row. The submit button has a white background and blue-cyan text (`#247ba9`), including hover. Keyboard focus uses a circular indicator around department icons and a rounded indicator around the password field.

## Existing accounts

Enter the existing password for the selected department. `departmentLogin.ts` matches the selected department to `Profile.group` before comparing the password:

| Selected department | Existing profile group | Accounts |
| --- | --- | --- |
| Sales | สาขา | SRC, KKL, SSS, Sale Admin |
| Purchasing | จัดซื้อ | Existing purchasing profile |
| Warehouse | คลังสินค้า | Existing warehouse profile |

Passwords, profile IDs, branch values, session persistence, and page permissions remain defined by the existing application. A password belonging to another department cannot sign in to the selected department. This release does not modify `auth.ts`, `App.tsx`, sales screens, database schemas, or application data.

## Files and checks

- `LoginPage.tsx`: department selection, password form, error handling, motion cancellation, and the existing `onLogin` callback.
- `LoginPage.css`: scoped login styles.
- `departmentLogin.ts`: department/profile matching and Guided Path keyframes.
- `npm run test:department-login`: checks the selected-department boundary, existing account types, and exact password matching.
- `npm run build`: TypeScript and production Vite build.

Reduced-motion preferences and unavailable animation APIs open the password form directly. Back navigation cancels pending movement, clears the password, and returns focus to the selected department. No entered password is logged or sent to a new service.

Deployment follows the existing GitHub `master` → Vercel pipeline for `https://anin-label.vercel.app/`. Experimental design galleries stay in the private design studio and are excluded from this production release.
