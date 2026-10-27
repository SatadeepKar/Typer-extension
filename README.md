# Auto Typer

A Chrome / Edge / Brave extension (Manifest V3). You give it a paragraph and it types it into any text field at the words-per-minute speed you choose.

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Pin **Auto Typer** to the toolbar.

## Use

1. Click the Auto Typer icon.
2. Paste your paragraph.
3. Set the speed with the slider or the number box. The slider goes up to 300 WPM, and you can type up to 2000 in the box.
4. Click **Start**. The popup closes and a countdown badge shows on the page (3 seconds by default).
5. Click into the text field you want filled before the countdown ends. Typing starts right after.
6. To stop, click **Stop** on the badge or in the popup. Typing also stops if you click outside the field.

Your paragraph and settings are saved between uses.

## Notes

- WPM uses the standard definition of 5 characters = 1 word.
- **Human-like rhythm** varies the time between keystrokes. The average speed still matches the WPM you set.
- **Occasional typos**: every 20–25 characters it types 2–6 wrong keys (keys next to the right ones on a QWERTY keyboard). It pauses briefly as if noticing, backspaces them, and carries on. The typing speeds up a little to make up for the extra keystrokes, so the finished text still arrives at the WPM you set. Untick it to type with no mistakes.
- It works with `<textarea>`, text-type `<input>` fields, and rich-text (contenteditable) editors such as Gmail, Notion, and most chat boxes, including editors inside iframes.
- Single-line inputs can't hold line breaks, so newlines are typed as spaces there.
- Chrome blocks extensions from `chrome://` pages and the Chrome Web Store.
- Editors that draw their own canvas instead of a real text field, such as Google Docs, may not accept the text.
