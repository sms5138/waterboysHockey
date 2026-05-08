# Site assets

Drop your team logos here. The site looks for these filenames — missing files are silently hidden, so the site still works without them.

| File | Where it shows | Suggested size |
|---|---|---|
| `logo.png` | Header (top-left) and centered on the login card | Square, ~256×256 |
| `favicon.png` | Browser tab icon | 32×32 or 64×64 |
| `banner.png` | Top of the login card (optional, full width) | ~960×240 |

To change colors, edit the variables at the top of [../styles.css](../styles.css):

```css
--team-primary: #0b3d91;     /* deep ice blue */
--team-secondary: #b81d24;   /* jersey red */
--team-accent: #f5c518;      /* gold accent */
```
