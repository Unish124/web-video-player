# Version v1.0.6

- Settings menu: opening a section (Playback speed, Skip amount, Button size) and going back now animates: the panels slide and fade, and the menu smoothly resizes to fit. Rows also react when hovered and pressed. Respects the system "reduce motion" setting.

## Earlier: v1.0.5

- Saved playlists: click anywhere on a video row to play it (the small play button still works; the remove button does not start playback).

## Earlier: v1.0.4

- Saved videos are now reachable from the start screen. A "Your saved videos" list shows every saved playlist (including named ones) with its video count; click one to open the player with those videos. Previously, if your videos were saved in a named playlist, reopening the site left you on the start screen with no way in except adding something new.
- Fixed the "Set as default video player" and "Shortcut guide" links overlapping the card on shorter windows.

## Earlier: v1.0.3

- Updates now show up right after you push: the service worker always checks the server for fresh files (instead of reusing the browser's 10-minute cache), checks for a new version on every visit, when you return to the tab and every 5 minutes, and refreshes the page automatically when nothing is loaded (otherwise it shows a "new version ready" message so your playlist is not lost).

## Earlier: v1.0.2

- Added "Set as default video player": the site is now an installable app (web app manifest, service worker, icons) that registers video file types (.mp4, .m4v, .webm, .mkv, .mov, .avi, .ogv). Once installed, videos opened from Windows play in the player; extra files join the open window's playlist.
- Added a step-by-step "Set as default video player" dialog (landing screen and Extra features menu) with an Install button and shortcuts to Windows default-app settings.
- Added a full shortcut guide (guide.html): keyboard, mouse, playlist, courses, extra features and default-player setup, with search and print / save as PDF. Linked from the landing screen and the ? shortcuts overlay.

## Earlier: v1.0.1

- Renamed "Open a course folder" to "Open folder".
- Added a Home button (top bar) that returns to the landing screen; a "Back to player" button appears there when a playlist is loaded.
- Playlist redesigned: number column, thumbnail with duration badge and progress bar, bold title, subtitle, and a three-dot menu.
- Hover a row to reveal a drag handle; drag rows up and down with smooth animation (auto-scroll, Escape to cancel, touch supported).
- Three-dot menu: save, move to top, move to bottom, remove.
- Removed code comments.
