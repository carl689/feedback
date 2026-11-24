# Labels, theming and accessibility

The reference for changing the widget's words and colors, and for how it behaves with a keyboard, a screen reader and a host page's own dialogs.

## Labels

Every word the widget shows. Pass any of them in `labels`; `{n}`, `{id}`, `{time}`, `{status}`,
`{duration}` and `{list}` are filled in. For a type of your own in `types`, the label key is
`type` plus the name with its first letter capitalized (`question` is `typeQuestion`); without
one, the name itself is shown.

| Key | English |
|---|---|
| `launcher` | Feedback |
| `title` | Send feedback |
| `typeLegend` | Type of feedback (the type buttons' group name, read by screen readers) |
| `typeBug` | Bug |
| `typeFeature` | Feature request |
| `typeMessage` | Message |
| `messageLabel` | Your message |
| `charactersLeft` | {n} characters left |
| `screenshot` | Screenshot |
| `record` | Record screen |
| `recordNote` | A recording stops if this page reloads or you leave it. (`''` hides it; shown where a recording cannot follow) |
| `recordNoteFollows` | The recording follows you from page to page on this site. It stops if you leave the site. (shown where it can) |
| `recordingLeft` | The recording stopped because the next page is on another site. That page opens when you send or close this. |
| `recordingBlocked` | The recording stopped because this site does not let the next page be shown in a frame. That page opens when you send or close this. |
| `screenshotCaption` | Screenshot of this tab |
| `recordingCaption` | Recording, {duration} |
| `remove` | Remove |
| `recording` | Recording (the recording pill's name) |
| `stop` | Stop |
| `onlyThisTab` | Only this tab can be captured. Choose this tab when the browser asks. |
| `anySurfaceNote` | This browser shares a whole window or screen, not only this page. Check the preview before you send. (under the buttons, only where the browser cannot promise this tab) |
| `captureFailed` | The screen could not be captured. |
| `recordingTimeLimit` | The recording stopped at its time limit. |
| `recordingSizeLimit` | The recording stopped at its size limit. |
| `alsoSent` | Also sent: {list}. |
| `sentFields` | Sent with it, as form fields: {list}. (under the expanded report, when `fields` is set) |
| `sentAddress` | this page's address |
| `sentBrowser` | your browser |
| `sentErrorsOne` | {n} console error |
| `sentErrorsOther` | {n} console errors |
| `sentRequestsOne` | {n} recent request |
| `sentRequestsOther` | {n} recent requests |
| `sentPagesOne` | {n} page visited |
| `sentPagesOther` | {n} pages visited |
| `sentUser` | your name as this page knows it |
| `sentContext` | details this site adds |
| `showReport` | Show exactly what is sent |
| `hideReport` | Hide what is sent |
| `cancel` | Cancel |
| `send` | Send |
| `sending` | Sending… |
| `retry` | Retry |
| `close` | Close |
| `sent` | Sent. |
| `sentWithId` | Sent, #{id} |
| `thanks` | Thank you. Your report was sent. |
| `failed` | It could not be sent. Check your connection, then retry. |
| `invalid` | The report was refused. Check it, then send again. |
| `outdated` | This page is out of date. Reload it, then send again. Your message is kept. |
| `signIn` | Sign in again, then send. Your message is kept. |
| `tooLarge` | The report is too large to send. |
| `unsupportedMedia` | An attachment is a kind of file that cannot be received. |
| `sendWithoutScreenshot` | Send without the screenshot |
| `sendWithoutRecording` | Send without the recording |
| `rateLimited` | Too many reports were sent. Try again later. |
| `rateLimitedUntil` | Too many reports were sent. Try again after {time}. |
| `disabled` | Feedback cannot be received at the moment. Your message is kept; try again later. |
| `refused` | The report was refused ({status}). |

The `One` and `Other` pairs are chosen by `Intl.PluralRules` for the locale; the "Also sent" list
is joined by `Intl.ListFormat`.

`recordNote` is shown under Record where a recording cannot follow the person to another page
(`video.follow` false, or a browser without the Navigation API): there a recording lives in the
page, and a single-page app records across its own route changes only. `recordNoteFollows` is
shown instead where it can.

## Theming

The panel lives in a shadow root: your CSS cannot reach into it and its CSS cannot leak out. It
takes six custom properties from your page, which cross the shadow boundary by design:

```css
:root {
  --feedback-accent: #0f766e;   /* the Send button, the picked type, focus rings. Default #2563eb */
  --feedback-accent-text: #fff; /* text on the accent. Default: chosen for you, see below */
  --feedback-surface: #ffffff;  /* the panel's background. Default #ffffff, #1c1c1f in dark */
  --feedback-text: #1f2328;     /* the panel's text. Default #1f2328, #ececee in dark */
  --feedback-radius: 12px;      /* the panel's corners */
  --feedback-font: system-ui, sans-serif;
}
```

Muted text, borders and hover tints are mixed from the text and surface colors, so they follow
yours. A value you set applies in both themes; to vary it, set it inside your own
`prefers-color-scheme` media query.

Text on the accent (Send, the picked type, Stop) is `--feedback-accent-text` when you set it.
When you do not, the panel reads the accent as your page resolves it each time it opens and uses
whichever of near-black (`#111111`) and white has the higher contrast against it, so the pair meets
4.5:1 wherever either can: the default blue keeps white text, a teal such as `#17a2b8` (about 3:1
with white) gets near-black. The accent is otherwise used only as a fill and as the focus ring.
When the accent is under 3:1 against the panel's surface (a pale accent in the light theme, a deep
one in the dark), focus rings are drawn in the text color instead and the accent-filled controls
get a thin edge, so neither depends on the accent being visible against the surface.

The launcher is drawn by the stub, which has no room for that check: its text is
`var(--feedback-accent-text, #fff)`. A page with a light accent that uses the launcher sets
`--feedback-accent-text` itself.
`theme: 'light'` or `'dark'` forces one scheme whatever the system prefers.

The look is meant to be quiet in any product: system fonts, one accent, no gradients, no icons.
The panel is never taller than the window: the title and the Cancel and Send row stay in view and
the part between them scrolls, and a refusal arriving is scrolled into view with its offer.
At 480 px wide and below the panel is a bottom sheet; it works at 320 px and with touch (44 px
targets on coarse pointers). The launcher, when drawn, is a plain button styled from script with
the same accent and font.

## Accessibility

- The panel is a modal dialog (`role="dialog"`, `aria-modal="true"`) named by its title. Focus
  moves into it on open (to the type buttons, or to the message when a type is already picked)
  and back to whatever opened it on close. When that element is gone, hidden or disabled (an item
  of a menu that closed, a button in a modal that closed), focus goes to what names its container
  (the nearest ancestor's `aria-labelledby`, as a menu names its toggle) or controls it
  (`aria-controls`); with neither, it is left on the page's body.
- Tab and Shift+Tab stay inside the panel; Escape closes it. Closing keeps the draft. A click on
  the dimmed page closes it too.
- The type buttons are a radio group: one Tab stop, the arrow keys move and pick (reversed left
  and right in a right-to-left locale).
- Every control has a visible word. The message box has a visible label; its counter is tied to it
  with `aria-describedby`. Refusals and failures are written into a `role="alert"` region, capture
  notices into a `role="status"` one, and the sent state is a status.
- Text meets 4.5:1 against its background in both themes with the default colors (the tests
  measure it).
- Under `prefers-reduced-motion` nothing animates.
- While recording, the panel shrinks to a small pill in the corner (a dot, the elapsed time,
  `Stop`) and the page is fully usable. Focus goes back to what opened the panel when it is still
  there, and otherwise stays on the page's body (never on a stand-in such as a menu's toggle), so
  typing (a barcode scanner's keys and Enter included) reaches the page's own handlers and never
  presses Stop; the pill is the last Tab stop on the page and announces "Recording" through a
  `role="status"` region.
  Escape does nothing to it, so a recording is never thrown away by a stray key; `Stop` ends it and
  the panel comes back with the recording playable.
- `locale` sets `dir` and `lang` on the panel.

### Over a host page's own dialog

The panel can be opened over a dialog of the page's own, a recording's Stop included. While the
panel or the recording pill shows, focus events inside the widget are stopped by a capturing
listener on `window`, which runs before any listener on `document` whatever the order they were
added in, so a script focus trap (Bootstrap's modal, jQuery UI's, a hand-written one, jQuery's
delegated `focusin`) never sees them and never pulls focus back. Focus that does leave the open
panel is brought back once and never chased, so two traps cannot call each other. A trap the page
adds as a capturing listener on `window` before the panel opens runs first and can still take
focus; the panel then simply loses it, without an error. Escape closes the panel only, and focus
goes back to whatever opened it, where the page's trap works as before.

A native `<dialog>` opened with `showModal()` makes the rest of the page inert, the widget
included. When one is open, the panel shows inside a modal `<dialog>` of its own, above it in the
top layer (the browser's dialog backdrop adds a light extra dimming), and the recording pill is put
inside the page's dialog, so the dialog stays usable while recording. If the page's dialog closes
during a recording, the pill moves back to the body.
