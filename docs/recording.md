# Screenshots and recordings

How screen capture works, what each browser allows, and how a recording keeps going from page to page.

## What each browser does

Screen capture needs `navigator.mediaDevices.getDisplayMedia`, which Android Chrome, Android and
iOS WebViews and iOS Safari do not have. There the Screenshot and Record buttons are absent and a
report is the message, the context and the errors. Recording also needs `MediaRecorder` with WebM
(VP9 or VP8) or MP4.

Where the browser can capture this tab and say so, capture is this tab only. That is decided at
every press from what the browser reports, never from its name: `getSupportedConstraints()` lists
`displaySurface` (Chrome and Edge today). The widget then asks with
`getDisplayMedia({video: {displaySurface: 'browser'}, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude', audio: false})`,
and whatever the person picks, a stream whose video track does not report
`getSettings().displaySurface === 'browser'` is stopped and thrown away with the line "Only this
tab can be captured". That proves the stream is a browser tab, not that it is this one: in a
browser whose picker offers other tabs as well, a person who picks one sends that tab, and the
preview shows it before anything is sent.

Where the browser can capture but cannot promise a tab (it does not list `displaySurface`: Firefox
today, which offers a window or the whole screen), the buttons are shown with the note
`anySurfaceNote` under them, the widget asks with `getDisplayMedia({video: true, audio: false})`
(a recording adds its frame rate and width), and it takes whatever the person picks; the preview
before Send is the safeguard, as everywhere. This is a stopgap for browsers without this-tab
capture: the day a browser starts reporting `displaySurface`, the strict rule applies there by
itself, with no release of the widget. `anySurface: false` keeps the strict rule everywhere, hiding
the buttons where it cannot hold. Each attachment's `surface` says what was captured when the
browser reports it.

A screenshot is the picture of what was shared, at its own size, scaled down when its longer side
is over 3,840 pixels (two screens side by side, say) and again until it is under 4 MB, so it stays
inside a receiver's 8,192 pixels and 5 MB. A recording uses `video.maxWidth` and `video.frameRate`
whatever was shared.

A WebM recording is written by the browser as a live stream, with no length in it (Chrome writes
no Duration, Firefox a Duration of 0): players other than the recording browser show none and
cannot seek until they have played it through. The widget writes the length into the file's header
before attaching it (only the first few kilobytes are read and rewritten; Firefox's Duration of 0
is overwritten in place; a file not of the expected shape is left as it was), so the preview, a
receiver and a saved file all know it. An MP4 recording is left alone.

The browser asks the person to confirm what is shared every time; that prompt is the consent. The panel
hides itself for the screenshot's frame. A tab sends frames only when something on it changes, so
while waiting for that frame the panel flips one nearly transparent pixel in the corner; it can be
in the screenshot. A recording of a page where nothing moves can come out empty, which the panel
says ("The screen could not be captured").

## Recording across pages

The capture belongs to the document that started it, so on a site where each link loads a new
page, a link click would end a recording. While a recording runs, the widget therefore keeps that
document: a navigation that would replace it is cancelled (the Navigation API's `navigate` event)
and its destination is loaded in a same-origin frame laid over the page. Once that page has
arrived the frame is shown, and the person carries on inside it, where later navigations happen
by themselves. The pill stays where it was, the this-tab-only check is untouched because the top
document is still the one captured, and the address bar, the title and the Back button follow the
framed page. One real video, one browser prompt.

What it follows: link clicks, navigations by script, GET and POST forms (fields and files posted
by the frame instead), a POST answered with a redirect, Back and Forward through the pages visited
(Back from the first visited page shows the page the recording began on, exactly as it was, with
its scroll and what was typed), a reload by script, downloads, links to a new tab, hash links,
addresses pushed by script, and links aimed at the whole window (`target="_top"`).

What it cannot hold: the browser's own Reload button, a typed address, and Back past the page the
recording began on. The browser never offers those to a page, so while there is a recording,
running or kept, the widget asks "Leave site?" first; Stay keeps everything, Leave ends it as
before. Navigations the covered page asks for by itself (its timers reloading it or sending it
elsewhere) are dropped, and so is a framed page's script sending the whole window somewhere,
since the two cannot be told apart; a person's own click aimed at the whole window is followed.

Leaving the site ends the recording. A navigation to another origin (a direct link, or a
same-origin address that redirects there, or a page that refuses to be framed) stops it, keeps
what was recorded, and says so in the panel (`recordingLeft`); the window goes to that address
once the panel is closed.

After Send or Cancel the person stays where they are, in the frame, with what they typed and their
place on the page, and an unsent recording stays in the panel. The window goes for real at their
next GET navigation out of the framed page (a link, a GET form, a script setting the address):
that navigation starts in the frame like any other, and once it commits there the frame goes blank,
its history is wound back, and the window loads the page. So the person sees the page they were on,
a blank moment and the new page, never the new page twice; and the new page is requested twice,
once by the frame (its load cut short) and once by the window. A navigation that never commits
stays in the frame: a download arrives and the person is where they were, a 204 does nothing, and
Stay at a page's own "Leave site?" keeps them there with what they typed, after which the next
navigation leaves as before. A POST from the framed page is followed in the frame, and the window
goes at the next GET. Back from the new page is the page the recording began on, with no dead steps
between. Back to the first page instead, and the next link from there is gone to for real.

While a recording or a screenshot is held unsent (after Cancel), nothing exits: the frame keeps
following, so the attachment survives until it is sent or removed.

Some ways out cannot be steered. The browser's own Reload, a typed address and a restored tab load
the address shown, which is the framed page's, for real: the person lands on that page, the page
the recording began on is no longer in the tab's history behind it, and the framed pages' steps
stay behind as Back presses that do nothing, one for each. With a recording running or held, Reload
and a typed address ask "Leave site?" first. A link to the very address the recording began on
leaves one Forward press that does nothing.

The page the recording began on stays alive beneath the frame until the window leaves it: its
timers, sockets and polling keep running, and a server that counts open pages counts it. Its
content is made `inert` while covered, and the keyboard goes back to it when it is shown again.
What it puts in the top layer by itself while covered (a modal `<dialog>` its script opens, a
popover left open at the change) stays beneath the frame, which is raised above it with the
keyboard. Printing while framed prints the framed page at its full height, without the covered
page. The frame's own `<dialog>` is exposed to assistive technology as nothing (`role="generic"`,
since Chrome exposes a dialog whatever `none` or `presentation` say), so the framed page reads as
the page; the pill stays the last Tab stop after it.

Every page visited is in the report: `pages` lists them, each error and request carries the
`page` it came from, and the report's `url` and `title` are the page the person sent it from. A
framed page's errors and request timings are collected when it goes (`pagehide`).

Requirements on the host:

- The site's own pages must be framable by the site itself: no `X-Frame-Options: DENY` and no
  `Content-Security-Policy: frame-ancestors 'none'` (`SAMEORIGIN` and `'self'` are fine). A page
  that refuses is treated as leaving the site.
- A page with a Content-Security-Policy allows its own pages in a frame: `frame-src 'self'` (or
  `child-src`), see [Content Security Policy](security.md#content-security-policy). Without it the recording
  stops at the next page, keeps what was recorded and says the site does not let the page be shown
  in a frame (`recordingBlocked`); the window goes there once the panel is closed.
- A framed page from the same origin runs the stub in adopted mode: it hands its error buffer to
  the widget of the page above, draws no launcher, never fetches the panel, and a press on its
  trigger opens the one panel above. Its `feedback.open()`, `close()`, `setContext()` and
  `reset()` reach that panel too, so a sign-out on a framed page clears the draft and an unsent
  recording. A stub framed by another site's page is an ordinary stub and touches nothing above.
- Over a native modal `<dialog>` of the page, the frame goes into the top layer with it.

`video.follow: false` installs nothing. Where the Navigation API is missing (Firefox and Safari at
the time of writing, which have no this-tab capture either) nothing is installed and a recording
ends at the page change, which the note under Record says.
