# Apple HIG reference for Deka

This file collects the rules from Apple's Human Interface Guidelines that matter for Deka.
Deka is a web app on iPhone. It runs in Safari or as a Home Screen app in standalone mode.

Pages read on 2026-09-23. Every rule is paraphrased from the live page text.
Numbers appear only where the page states them. Where a page gives no number, the row says so.

How to read the tables:

| Column | Meaning |
|---|---|
| Rule | The key rule, with the page's own numbers |
| For a web app on iPhone | How it maps to a PWA in Safari or standalone mode, or why it does not apply |
| Deka today | What the app does now, checked against the code on 2026-09-23 |
| Source | The HIG page |

A note on units. In Safari on iPhone, one CSS pixel equals one point at the default zoom.
So a 44 pt target is a 44 px target in our CSS.

House rules win over Apple wherever the two conflict. See the section on conflicts at the end.

# Foundations

## Accessibility

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Let people enlarge text. Ideally allow at least 200 percent enlargement, through Dynamic Type or custom UI. | Size text in rem and set the root from the system text style, for example `font: -apple-system-body` on `html`, then set the family back to Figtree. Safari then follows the Dynamic Type setting. Also test with Safari page zoom. | Yes. On iOS the root is set by `font: -apple-system-body` and all text is in rem, so every style follows Dynamic Type. | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Default and minimum text sizes on iOS: 17 pt default, 11 pt minimum. Thin custom fonts need larger sizes. | Body at 17 px, nothing below 11 px. Avoid Figtree Light and thinner weights for small text. | Reading text is 17 px. Captions are floored at 11 px with `max(11px, ...)`. Figtree 400 to 700, no light weights. | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Contrast minimums, from WCAG Level AA as used by Accessibility Inspector: text up to 17 pt needs 4.5:1. Text at 18 pt needs 3:1. Bold text of any size needs 3:1. | Same ratios apply in CSS. Check every text and icon color against the ivory background. Light accent colors used as text often fail 4.5:1. | Light ink 16.7:1, secondary text 8.1:1, category tints 5.2 to 5.7:1 on the page and about 4.5:1 on their own tinted chips. Dark passes too, see Dark Mode. | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| If the default palette does not reach the minimum, offer a higher contrast scheme when Increase Contrast is on. Check contrast in both light and dark appearances. | Use `@media (prefers-contrast: more)` for a stronger palette. | Not applied. No `prefers-contrast: more` styles. The default palettes already pass 4.5:1 in both themes. | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Do not convey information with color alone. Add shapes, icons or text for state changes. | A done state needs a mark or icon, not only a fill color. | Mostly. Missed sessions fade, unconfirmed ones get a dashed outline, the day sheet adds a check mark, and VoiceOver hears a state word. On the Days rows, done versus planned shows mainly as the chartreuse fill. | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Control sizes on iOS: 44x44 pt default, 28x28 pt minimum. | Give every tappable element a hit area of at least 44x44 px. Padding can extend the hit area past the visible icon. | Yes. A browser test fails any control under 44 by 44 px at 375, 390 and 430 px widths. | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Spacing between controls matters as much as size. About 12 pt of padding around elements with a bezel. About 24 pt around the visible edges of elements without a bezel. | Bare icon buttons need about 24 px clear space around the glyph, or a bezel with about 12 px. | Partly. Hit areas stay 44 px, but gaps are small: Days session icons 6 px apart, chips 6 px, icon picker 4 px. | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Offer alternatives to gestures. If a swipe dismisses a view, also provide a button. | Every swipe or drag action, such as swipe to dismiss a sheet, needs a visible button too. | Yes. Every sheet has a Close button, and the scrim and Escape close it too. Dragging sessions between days is a desktop extra; touch uses the goal sheet. | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Label elements for VoiceOver and Voice Control. | Give icon buttons an `aria-label`. Use real `button` elements so VoiceOver and Voice Control find them. | Yes. Real `button` elements; icon buttons and tabs carry an `aria-label`, and every SVG is `aria-hidden`. | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Minimize time boxed elements. Views that auto dismiss on a timer are a problem for people who need more time. Prefer dismissing with an explicit action. | Toasts with Undo must stay long enough, pause while focused or touched, and never be the only path to undo. | Undo toasts last 6 seconds. The timer restarts when the toast is touched and stops while it has focus. A check off also undoes by tapping again. | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Honor Reduce Motion. Reduce automatic and repeating animation, including zooming, scaling and peripheral motion. Tighten springs to cut bounce. Track animation to gestures. Replace x, y and z transitions with fades. Avoid animating into and out of blurs. | Use `@media (prefers-reduced-motion: reduce)`. Swap slides for fades, remove bounce, and calm or stop looping motion such as a living logo. | Yes. With Reduce Motion nothing moves, sheets and toasts fade, the spring becomes ease out, and the logo mark breathes instead of waving. | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Pair audio cues with haptics and visual cues. | Deka has no sound. Visual cues are the main channel. | No sound. Check off fills with chartreuse and bursts dots, plus `navigator.vibrate` where supported (not in iOS Safari). | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Support keyboard only use with Full Keyboard Access, and Switch Control. Do not override system shortcuts. | Keep a logical focus order, visible focus rings and no keyboard traps in sheets. | Visible `:focus-visible` rings, the page behind a sheet is inert, focus moves to the sheet title, Escape closes, and focus returns to the control that opened the sheet. | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Assistive Access: remove noncritical flows, one interaction per screen, and confirm twice before hard to recover actions such as deleting a file. | Does not apply. Assistive Access runs apps built for it, not web pages. | Not applied. Assistive Access does not run web pages. | https://developer.apple.com/design/human-interface-guidelines/accessibility |

## Color

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Do not use one color to mean different things. Keep status and interactive colors consistent. | Reserve the done color for done. Do not reuse it for links or decoration. | Partly. Chartreuse means done, but it also marks today, the primary button, the selected tab dot and text selection. | https://developer.apple.com/design/human-interface-guidelines/color |
| Make every color work in light, dark and increased contrast. Custom colors need light and dark variants, each with an increased contrast option. Even a single appearance app should provide light and dark colors to support Liquid Glass adaptivity. | Define colors as CSS custom properties with overrides under `prefers-color-scheme: dark` and `prefers-contrast: more`. | Light and dark tokens as custom properties under `prefers-color-scheme`. No increased contrast variants. | https://developer.apple.com/design/human-interface-guidelines/color |
| Test under varied lighting and on real devices. Bright light makes colors darker and muted; dark rooms make them bright and saturated. True Tone shifts the white point. | Test outdoors and at low brightness on an iPhone, not only in a desktop browser. | Not verifiable in code. Contrast is checked by ratio and Lighthouse; no record of outdoor or low light tests. | https://developer.apple.com/design/human-interface-guidelines/color |
| Colors change behind translucent elements such as toolbars. | Check the glass tab bar and composer over every background the content can show. | Glass is a 72% ivory fill (70% near black in dark) under a 22 px blur, so ink stays legible over cards. | https://developer.apple.com/design/human-interface-guidelines/color |
| Do not rely on color alone. Use labels or glyph shapes too. | Same as Accessibility. | Same as Accessibility: faded and dashed states and state words for VoiceOver. | https://developer.apple.com/design/human-interface-guidelines/color |
| Consider cultural meanings of color. | Keep in mind if Deka is localized. | Not applied. English only, no localization. | https://developer.apple.com/design/human-interface-guidelines/color |
| Liquid Glass has no color of its own; it takes color from content behind it. On small elements such as toolbars and tab bars, symbols and text are monochrome by default and flip dark or light with the content beneath. | A CSS glass bar should keep icons in one ink color and check legibility over light and dark content. | Tab and composer icons use one ink color, softer when unselected. They do not flip, since content behind is always the app ground. | https://developer.apple.com/design/human-interface-guidelines/color |
| Apply color to glass sparingly. For a primary action, color the background, not the symbol or text. Do not tint the background of several controls. | At most one tinted control per surface, for example the send button in the composer. | Yes. The ink send button is the only filled control in the composer. The tab bar tints only the selected lens. | https://developer.apple.com/design/human-interface-guidelines/color |
| Keep the resting state legible: the top of a scrolling screen must have clear contrast under controls. | Check the first screenful of each tab under the tab bar and composer. | Yes. The header is solid and scrolls away. The page pads its end so the last item clears the tab bar and composer. | https://developer.apple.com/design/human-interface-guidelines/color |
| Use wide color (Display P3) where it helps. sRGB is accurate on most displays. | CSS `color(display-p3 ...)` works in Safari with an sRGB fallback. Optional. | Not applied. All colors are sRGB. | https://developer.apple.com/design/human-interface-guidelines/color |
| iOS background hierarchy: primary for the overall view, secondary for groups within it, tertiary for groups within those. | Define three background tokens in the same way. | Yes. `--paper` for the page, `--paper-deep` for bubbles and an opened day, `--surface` for cards and large sheets. | https://developer.apple.com/design/human-interface-guidelines/color |

## Dark Mode

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| People expect every app to respect the systemwide appearance. Avoid an app specific appearance setting. | Follow `prefers-color-scheme`. Do not add an in app theme switch. | Yes. Follows `prefers-color-scheme`. No theme switch. | https://developer.apple.com/design/human-interface-guidelines/dark-mode |
| Look good in both modes. Auto can switch appearance while the app runs. | Colors must update live when the media query changes, with no reload. | Yes. Colors are custom properties under the media query, so they switch live. A theme-color meta per scheme. | https://developer.apple.com/design/human-interface-guidelines/dark-mode |
| Contrast in all appearances: no lower than 4.5:1. For custom foreground and background colors, strive for 7:1, especially for small text. | Aim for 7:1 for body text in both themes. | Dark ink 16.7:1, secondary 8.5:1, tints 8.2 to 9.8:1 on the page and 6.9 to 8.1:1 on chips. In light, ink and secondary pass 7:1; tints sit at 5.2 to 5.7:1. | https://developer.apple.com/design/human-interface-guidelines/dark-mode |
| Dark palettes use dimmer backgrounds and brighter foregrounds. They are not simple inversions. | Tune each dark token by hand. Do not invert the light palette. | Yes. Tuned by hand: warm near black #14130F, ivory text, lifted category tints, chartreuse for done. | https://developer.apple.com/design/human-interface-guidelines/dark-mode |
| iOS uses base and elevated backgrounds. Elevated, brighter colors mark foreground layers such as sheets and popovers. | In dark mode, sheets should sit on a slightly lighter surface than the page. | Yes. Cards and large sheets use `--surface` #1C1B17 and glass is a warm dark gray, both lighter than the page. | https://developer.apple.com/design/human-interface-guidelines/dark-mode |
| Test with Increase Contrast and Reduce Transparency on, separately and together. | Test `prefers-contrast: more` together with the dark scheme. | Reduce Transparency swaps glass for solid in both themes. Increase Contrast has no styles to test. | https://developer.apple.com/design/human-interface-guidelines/dark-mode |
| Soften white backgrounds in images so they do not glow in dark mode. Make icons work in both appearances or provide separate versions. | Check the logo mark and any images on a dark background. | The mark and tab icons use `currentColor`, so they turn ivory. Dark launch images use the near black ground. No photos. | https://developer.apple.com/design/human-interface-guidelines/dark-mode |
| In rare cases, a dark only interface is fine, for example immersive media viewing. | Not Deka's case. | Not applied. Light and dark are both supported. | https://developer.apple.com/design/human-interface-guidelines/dark-mode |

## Layout

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Order content by importance, top to bottom and leading to trailing. | Put the key item of each tab first. | Chat opens at the newest message. Days leads with today's number. Goals leads with the done count. | https://developer.apple.com/design/human-interface-guidelines/layout |
| Align elements and use indentation to show hierarchy. Group related items with space, containers or separators. | Use one consistent left edge and a spacing scale. | Yes. One column, one 16 px side margin plus safe area, hairline separators between rows. | https://developer.apple.com/design/human-interface-guidelines/layout |
| Use progressive disclosure to keep layouts clean. | Show detail in sheets or expandable rows, not all at once. | Yes. A day opens in a sheet, a plan card opens one day at a time, past dekas expand inline. | https://developer.apple.com/design/human-interface-guidelines/layout |
| Differentiate controls from content with Liquid Glass. Instead of a solid or semi opaque background under controls, use a scroll edge effect. Extend full screen backgrounds under toolbars and tab bars. | Let content scroll under the glass bars, and fade or blur it near the bar edge with a gradient mask. | Content scrolls under the floating tab bar and composer. No scroll edge fade or blur. | https://developer.apple.com/design/human-interface-guidelines/layout |
| Respect safe areas so the Dynamic Island, status bar and home indicator do not cover content or controls. | Use `viewport-fit=cover` and pad with `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`. In standalone mode the status bar area is part of the page. | Yes. `viewport-fit=cover` and safe area insets on all edges. The header pads by the top inset. | https://developer.apple.com/design/human-interface-guidelines/layout |
| Be ready for text size changes: stack side by side views, let rows grow in height, allow one line rows to wrap. | Use flexible heights and wrapping. Avoid fixed row heights. | Mostly. Rows use min heights, settings rows wrap, text uses `text-wrap: pretty` and `balance`. Settings labels and day dates do not wrap. | https://developer.apple.com/design/human-interface-guidelines/layout |
| Adapt to screen sizes, orientation and Display Zoom. Decide layout from available space, not device type. | Use fluid widths and container or media queries. Test the smallest and largest iPhones. | Fluid single column up to 620 px wide, tested at 375, 390 and 430 px. Portrait only launch images. | https://developer.apple.com/design/human-interface-guidelines/layout |
| Keep functionality the same across sizes. Only the amount shown may change. | Wide screens may show more, but no feature should vanish on a narrow one. | Yes. One layout at every width; wide screens only get more margin. | https://developer.apple.com/design/human-interface-guidelines/layout |
| The page gives no general iOS margin or spacing numbers. tvOS has fixed safe margins; iOS has no extra layout rules. | Pick our own spacing scale. | 16 px side margins, 44 px targets, list rows of 60 to 68 px. | https://developer.apple.com/design/human-interface-guidelines/layout |

## Materials and Liquid Glass

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Apple has two kinds of material: Liquid Glass for controls and navigation, and standard materials for the content layer. | There is no Liquid Glass API on the web. Approximate it with `backdrop-filter` blur and saturation over a translucent fill. Keep the `-webkit-` prefix for older Safari. | Yes. `backdrop-filter: blur(22px) saturate(180%)` with the `-webkit-` prefix over a translucent fill, and a solid fill where blur is missing. | https://developer.apple.com/design/human-interface-guidelines/materials |
| Liquid Glass is a separate functional layer that floats above content, for things like tab bars and sidebars. Content scrolls and peeks through beneath it. | The tab bar and composer float above scrolling content; content should pass under them. | Yes. The tab bar and composer are fixed and float; content scrolls beneath them. | https://developer.apple.com/design/human-interface-guidelines/materials |
| Do not use Liquid Glass in the content layer. Use standard materials there, for example for app backgrounds. Exception: sliders and toggles take on glass while being touched. | Do not put glass on cards, rows or sheets content. Keep glass for bars and the composer. | Yes. Chat cards and rows are a solid surface with a hairline border. Sheets are glass only at medium and fit; at large they are solid. | https://developer.apple.com/design/human-interface-guidelines/materials |
| Use glass sparingly. Limit custom glass to the most important functional elements. | Glass on the tab bar and composer only. | Glass only on floating layers: tab bar, composer, toast and sheets. | https://developer.apple.com/design/human-interface-guidelines/materials |
| Two variants. Regular blurs and adjusts luminosity for legibility; most system parts use it, and it suits text heavy parts such as alerts and popovers. Clear is highly translucent, only for parts over visually rich media such as photos and video. | Use a regular style glass: strong blur and a light fill. A clear style only fits over photos or video. | A regular style: strong blur, raised saturation and a 70 to 72% fill. No clear style. | https://developer.apple.com/design/human-interface-guidelines/materials |
| With clear glass over bright content, consider a dark dimming layer at 35% opacity. No dimming layer is needed over dark content. | Only relevant if Deka ever shows glass over images. | Not applied. Glass never sits over images. | https://developer.apple.com/design/human-interface-guidelines/materials |
| Appearance changes with system settings: a preferred glass look, Reduce Transparency and Increase Contrast. | Provide a solid, opaque fallback under `prefers-reduced-transparency: reduce` where Safari supports it, and under `prefers-contrast: more`. | `prefers-reduced-transparency` swaps glass for the solid surface. No `prefers-contrast` fallback. | https://developer.apple.com/design/human-interface-guidelines/materials |
| Scroll edge effects blur and fade content beneath bars to keep them legible. | Add a short gradient fade or blur strip at the top and bottom edges where content meets bars. | Not applied. No fade or blur strip at bar edges. | https://developer.apple.com/design/human-interface-guidelines/materials |
| iOS standard materials: ultra thin, thin, regular (default) and thick. Thicker is more opaque with better contrast for fine text. Thinner keeps more context. Avoid quaternary labels on thin and ultra thin materials. | Use a thicker, more opaque style when glass holds text; keep secondary text strong enough. | The glass fill is 70 to 72%, and secondary text keeps 70 to 76% ink. | https://developer.apple.com/design/human-interface-guidelines/materials |
| Adopting Liquid Glass: remove custom backgrounds from bars, since they can clash with system effects. Avoid crowding or stacking glass elements on top of each other. | Do not stack a glass toast over the glass tab bar or composer without spacing. | The toast sits 16 px above the composer or tab bar, and the composer 8 px above the tab bar. | https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass |
| Adopting Liquid Glass: controls are rounder, following hardware curvature. Use shapes concentric with their containers. | Match corner radii of bars and buttons so inner radius equals outer radius minus padding. | Yes. Tab bar radius 31 with 4 px padding around 27 px tab capsules. The composer and toast use radius 26 around 22 px round buttons. | https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass |
| Adopting Liquid Glass: sheets have a larger corner radius. Half sheets are inset from the display edge so content peeks through. A half sheet becomes more opaque when it expands to full height. | Inset bottom sheets from the sides and bottom at the medium height, and make them more opaque at full height. | Yes. Medium and fit sheets float inset 8 px on glass with 32 px corners; at large they meet the edges on a solid surface. | https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass |
| Adopting Liquid Glass: tab bars can minimize while scrolling and expand when scrolling back. | Optional: shrink the glass tab bar on scroll down, restore on scroll up. | Not applied. The tab bar keeps its size on scroll. See What Deka does not apply. | https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass |
| Adopting Liquid Glass: provide an accessibility label for every icon, even when icons replace text. | Every icon only control needs an `aria-label`. | Yes. Every icon only control has an `aria-label`. | https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass |
| Adopting Liquid Glass: test custom elements with reduced transparency and reduced motion, since those settings remove or change effects. | Test with Reduce Transparency, Reduce Motion and Increase Contrast turned on. | Reduce Motion and Reduce Transparency have their own styles, and a test covers Reduce Motion. Increase Contrast has none. | https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass |

## Motion

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Add motion only with purpose. Gratuitous animation distracts and can cause discomfort. | Every animation should explain a change of state. | Motion shows change: plans pop into the ten day strip day by day, moved sessions glide, check off fills and bursts dots. | https://developer.apple.com/design/human-interface-guidelines/motion |
| Make motion optional. Never use it as the only way to convey information. | Pair animation with a static state change. Honor `prefers-reduced-motion`. | Yes. Every animation ends in a static state, and Reduce Motion removes movement. | https://developer.apple.com/design/human-interface-guidelines/motion |
| Feedback motion should follow gestures and expectations. A view revealed by sliding down should not be dismissed by sliding sideways. | A sheet that rises from the bottom should dismiss downward. | Yes. Sheets rise from the bottom and drag or flick down to dismiss. | https://developer.apple.com/design/human-interface-guidelines/motion |
| Keep feedback animations brief and precise. | Keep feedback short. The page states no duration. | Presses take 0.15 to 0.3 s, the check off pop 0.45 s, the burst 0.6 s. | https://developer.apple.com/design/human-interface-guidelines/motion |
| Avoid adding motion to frequent interactions in apps. | Tab switches and row taps should be near instant. | Tab switches draw at once; only the heading fades up 6 px. Row taps show a pressed state only. | https://developer.apple.com/design/human-interface-guidelines/motion |
| Let people cancel motion. Do not make people wait for an animation to finish before acting. | Keep controls live during transitions; interrupting a sheet animation must work. | Controls stay live during animations, and a sheet can be dragged while it moves. A reply cannot be stopped. | https://developer.apple.com/design/human-interface-guidelines/motion |
| Liquid Glass motion responds to direct touch with more emphasis. | Optional subtle press response on glass controls. | Tabs and buttons shrink to 94 to 97% on press with a spring. | https://developer.apple.com/design/human-interface-guidelines/motion |
| No durations or spring values are given on the motion page. The only spring guidance is in Accessibility: tighten springs to reduce bounce when Reduce Motion is on. Games: 30 to 60 fps. | Choose our own timing. Reduce or remove overshoot under reduced motion. | A spring curve in CSS `linear()` with a small overshoot, on transform and opacity. Under Reduce Motion it becomes ease out and nothing moves. | https://developer.apple.com/design/human-interface-guidelines/motion |

## Typography

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| iOS default text size 17 pt, minimum 11 pt. Thin custom fonts should go larger. | Body 17 px, floor 11 px. | Body 17 px (1rem). Captions floored at 11 px. | https://developer.apple.com/design/human-interface-guidelines/typography |
| Avoid light weights. With system fonts prefer Regular, Medium, Semibold or Bold. Avoid Ultralight, Thin and Light, especially at small sizes. | Use Figtree 400 to 700. No 100 to 300 weights for UI text. | Yes. Figtree 400 to 700 only. No light or thin weights. | https://developer.apple.com/design/human-interface-guidelines/typography |
| Use weight, size and color for hierarchy, and keep that hierarchy when text size changes. | Scale all styles together from one root size. | Yes. All text tokens are rem from one root that follows Dynamic Type. | https://developer.apple.com/design/human-interface-guidelines/typography |
| Minimize the number of typefaces. | Figtree only. | Figtree for all UI text. Melomaniac Serif only in the header wordmark. | https://developer.apple.com/design/human-interface-guidelines/typography |
| Custom fonts must be legible and must support Dynamic Type and Bold Text like system fonts do. | Tie sizes to `-apple-system-body` and related styles so Figtree follows Dynamic Type. Bold Text has no direct web signal; weights above 400 help. | Root set by `font: -apple-system-body` with Figtree set back on `body`. Bold Text is not supported. | https://developer.apple.com/design/human-interface-guidelines/typography |
| Prioritize important content when text size grows. Not every word needs to grow, for example tab titles. | Let body and list text scale fully; tab bar and chrome may scale less. | All text scales together. Tab icons and the Days icon buttons are sized in rem and grow with it; smaller icons stay fixed. | https://developer.apple.com/design/human-interface-guidelines/typography |
| Leading: loose for long passages and wide columns, tight where height is limited. Avoid tight leading for three or more lines. | Use about 22 px line height for 17 px body per the table below. | Reading text runs at 1.45 to 1.55, about 25 to 26 px at 17 px. Looser than Apple's 22 for easier reading. | https://developer.apple.com/design/human-interface-guidelines/typography |
| Layouts must adapt to all sizes. Test with Larger Accessibility Text Sizes on. | Test Settings, Accessibility, Display and Text Size, Larger Text, at the maximum. | Not verified. The tests found run at the default text size only. | https://developer.apple.com/design/human-interface-guidelines/typography |
| Enlarge meaningful icons as text grows. | Size icons in em or rem so they grow with text. Phosphor icons do not scale by themselves like SF Symbols do. | Partly. Tab icons and the Days icon buttons are sized in rem, so they grow with text; the Days buttons never go under 44 px. Icons in cards and rows stay in px. | https://developer.apple.com/design/human-interface-guidelines/typography |
| Keep truncation to a minimum at large sizes. Aim to show as much text at the largest accessibility size as at the largest standard size. | Prefer wrapping over ellipsis. | Yes. No ellipsis anywhere; text wraps. Settings labels and day dates are kept on one line. | https://developer.apple.com/design/human-interface-guidelines/typography |
| At large sizes, stack text above secondary items and reduce the number of columns. | Switch inline rows to stacked rows at large root sizes. | Partly. Settings rows wrap onto two lines. Other rows keep their side by side layout. | https://developer.apple.com/design/human-interface-guidelines/typography |
| Keep primary elements toward the top even at very large sizes. | Do not push key content below the fold with oversized headers. | Not handled on purpose. The large Day and Goals titles grow with text and can push rows down. | https://developer.apple.com/design/human-interface-guidelines/typography |
| Do not embed system fonts in an app. | We use Figtree, so this does not apply. | Not applied. Figtree is self hosted; no system font is embedded. | https://developer.apple.com/design/human-interface-guidelines/typography |
| SF Pro tracking varies by size, for example 17 pt at minus 0.43 pt, 20 pt at minus 0.45 pt, 12 pt at 0, 11 pt at plus 0.06 pt. | These values are for SF Pro. Figtree needs its own tracking; do not copy SF values blindly. | Figtree uses its own tracking: minus 0.025 em on large titles, the default elsewhere. | https://developer.apple.com/design/human-interface-guidelines/typography |

### iOS text styles at the default Large size

As stated on the typography page. Sizes and leading are in points.

| Style | Weight | Size | Leading | Emphasized weight |
|---|---|---|---|---|
| Large Title | Regular | 34 | 41 | Bold |
| Title 1 | Regular | 28 | 34 | Bold |
| Title 2 | Regular | 22 | 28 | Bold |
| Title 3 | Regular | 20 | 25 | Semibold |
| Headline | Semibold | 17 | 22 | Semibold |
| Body | Regular | 17 | 22 | Semibold |
| Callout | Regular | 16 | 21 | Semibold |
| Subhead | Regular | 15 | 20 | Semibold |
| Footnote | Regular | 13 | 18 | Semibold |
| Caption 1 | Regular | 12 | 16 | Semibold |
| Caption 2 | Regular | 11 | 13 | Semibold |

### Body size at every Dynamic Type setting

From the same page. Size and leading in points.

| Setting | Body size | Body leading | Large Title size |
|---|---|---|---|
| xSmall | 14 | 19 | 31 |
| Small | 15 | 20 | 32 |
| Medium | 16 | 21 | 33 |
| Large (default) | 17 | 22 | 34 |
| xLarge | 19 | 24 | 36 |
| xxLarge | 21 | 26 | 38 |
| xxxLarge | 23 | 29 | 40 |
| AX1 | 28 | 34 | 44 |
| AX2 | 33 | 40 | 48 |
| AX3 | 40 | 48 | 52 |
| AX4 | 47 | 56 | 56 |
| AX5 | 53 | 62 | 60 |

Note that large styles grow less than body text. At AX5 body is 53 pt while Large Title is only 60 pt.
The Caption 2 floor of 11 pt holds at xSmall, Small, Medium and Large.

## Writing

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Be clear. Check each word is needed. If fewer words work, use fewer. | Matches our house rule of minimal words. | Yes. Short lines such as "Tell Deka your goals" and "Nothing planned. A free day." | https://developer.apple.com/design/human-interface-guidelines/writing |
| Write for everyone: plain language, no jargon, no gendered terms. | Same for web. | Plain words. "Deka" is the one coined term, explained on the intro screen. | https://developer.apple.com/design/human-interface-guidelines/writing |
| Be action oriented. Label buttons with a verb. Avoid cute labels: "Send" beats "Let's do it!". Avoid "Click here". | Same for web. | Yes. Verbs such as Confirm, Tweak, Add, Enter, Download, Discard, Lock and Try again. | https://developer.apple.com/design/human-interface-guidelines/writing |
| Pick a capitalization style per element type and apply it everywhere. Title case is formal, sentence case casual. | We use sentence case everywhere. Apple allows this choice here, though some component pages ask for title case. See Conflicts. | Sentence case everywhere, including the type control and the chat day separators. | https://developer.apple.com/design/human-interface-guidelines/writing |
| Use consistent step labels in flows: start with a phrase like "Get Started", use "Continue" or "Next", finish with "Done". | Pick one set of words for Deka's flows and keep it. | No long flows. The intro says "Plan my first deka"; sheets end with Done or Add. | https://developer.apple.com/design/human-interface-guidelines/writing |
| Use possessive pronouns sparingly: "Favorites", not "Your Favorites". Avoid "we", as in "We're having trouble loading this content"; prefer "Unable to load content". | Same for web. | Partly. No "we" in messages, but some copy uses "your" or "my", such as "Your next deka is set." and "Plan my first deka". | https://developer.apple.com/design/human-interface-guidelines/writing |
| Describe gestures correctly for the device: "tap", not "click", on iPhone. | Say tap. | Yes. Copy says tap, such as "Tap a day to add it." | https://developer.apple.com/design/human-interface-guidelines/writing |
| Give clear next steps on empty screens, ideally with a button. Do not put crucial information in an empty state, since it disappears. | Each empty tab needs one line and one action. | Yes. Empty Days and Goals each have one line and an Open chat button. Goals also offers Add one by hand. | https://developer.apple.com/design/human-interface-guidelines/writing |
| Error messages: close to the problem, no blame, say how to fix it. Avoid "oops" and "uh oh". | Same for web. | Errors sit under the reply with Try again: "Deka did not answer.", "You are offline.", "Too many messages. Wait a few minutes." | https://developer.apple.com/design/human-interface-guidelines/writing |
| Settings labels: describe what the setting does when on. To send someone to a setting, give a direct link or button. | Same for web. | Labels say what they do, such as "Daily check in" and "Export all data". No links to system settings. | https://developer.apple.com/design/human-interface-guidelines/writing |

## Icons and SF Symbols

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Keep interface icons simple and recognizable, with familiar metaphors. | Same for Phosphor icons. | Phosphor goal icons with familiar metaphors, and the ten dot mark for Deka. | https://developer.apple.com/design/human-interface-guidelines/icons |
| Keep all icons consistent in size, detail, stroke weight and perspective. | Use one Phosphor weight throughout. | Phosphor regular for goal icons, bold at small sizes. A few UI glyphs (back, close, send, mic, more) are simple inline strokes. | https://developer.apple.com/design/human-interface-guidelines/icons |
| Match icon weight to adjacent text weight. | Pair Phosphor regular with 400 text and bold with 600 or 700 text. | Yes. Small icons in the plan strip use Phosphor bold so the stroke matches nearby text. | https://developer.apple.com/design/human-interface-guidelines/icons |
| Optically center asymmetric icons with padding. | Nudge icons such as arrows by a pixel where they look off. | Only the wordmark and the inline mark are nudged by 1 px. No other optical offsets. | https://developer.apple.com/design/human-interface-guidelines/icons |
| Use vector formats such as SVG or PDF. | An SVG sprite fits this. | Yes. One inline SVG sprite, built by scripts/icons.js. | https://developer.apple.com/design/human-interface-guidelines/icons |
| Provide text alternatives for custom icons so VoiceOver can describe them. | `aria-label` on the button, `aria-hidden` on the decorative SVG. | Yes. Buttons carry the label, and every SVG is `aria-hidden`. | https://developer.apple.com/design/human-interface-guidelines/icons |
| Standard action icons use SF Symbols, for example Undo is arrow.uturn.backward, Add is plus, Delete is trash, More is ellipsis, Done is checkmark, Cancel is xmark. | Use Phosphor equivalents with the same metaphors. | Same metaphors: x for close, chevron for back, up arrow for send, check for done. Undo is a text button. | https://developer.apple.com/design/human-interface-guidelines/icons |
| SF Symbols license limit: the terms prohibit using symbols, or confusingly similar images, in app icons, logos or any other trademarked use. Symbols of Apple products are copyrighted and cannot be customized. | We do not use SF Symbols, so this does not apply. Our logo mark and app icon must not resemble an SF Symbol. The page does not restate the rest of the license; read the SF Symbols license before using any symbol on the web. | Yes. No SF Symbols. The mark is a ten dot spiral of our own. | https://developer.apple.com/design/human-interface-guidelines/sf-symbols |
| Tab bars prefer the fill variant of a symbol; toolbars prefer outline. | Use filled Phosphor icons for the selected tab, or for all tabs; outline for toolbar actions. | Not applied. The tab icons are the mark, a dot grid and a Phosphor target; selection shows by color, a lens and a dot. | https://developer.apple.com/design/human-interface-guidelines/sf-symbols |

## App icons

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| iOS app icon layout is 1024x1024 px, square, masked by the system into a rounded rectangle. | A Home Screen web app uses `apple-touch-icon`. Provide a square, full bleed, unmasked image; iOS rounds the corners. | Square, opaque PNGs at 180, 192 and 512 px plus a maskable 512, built by scripts/brand.js. iOS rounds the corners. | https://developer.apple.com/design/human-interface-guidelines/app-icons |
| Icons are layered and get Liquid Glass highlights, refraction and translucency. Built in Icon Composer. | Does not apply. A web app supplies one flat image, with no layers. | Not applied. One flat image. | https://developer.apple.com/design/human-interface-guidelines/app-icons |
| Appearances: default, dark, clear and tinted. The system generates variants you do not provide. | We can only provide one image, so test it in dark, clear and tinted Home Screen modes. | One image: an ivory mark on warm near black. Dark, clear and tinted Home Screen modes not verified. | https://developer.apple.com/design/human-interface-guidelines/app-icons |
| Embrace simplicity: one core idea, few shapes, a simple background such as a solid color or gradient. | Same. | Yes. The ten dot mark on a solid near black ground. | https://developer.apple.com/design/human-interface-guidelines/app-icons |
| Include text only if essential. Avoid words like "Watch" or "Play". | Same. | Yes. No text. | https://developer.apple.com/design/human-interface-guidelines/app-icons |
| Keep primary content centered to avoid clipping by the mask. | Keep the mark inside the central area. | Yes. The mark is centred inside the corner radius; the maskable icon is scaled to its safe zone. | https://developer.apple.com/design/human-interface-guidelines/app-icons |
| Avoid very thin lines and sharp corners; they lose detail at small sizes. Do not add your own shadows, bevels or glows. | Test the icon at small sizes such as Spotlight and Settings. | No shadows or glows. Dots stay round; the smallest is about 33 px across at 1024. Small size tests not verified. | https://developer.apple.com/design/human-interface-guidelines/app-icons |
| Do not replicate UI components, screenshots or Apple hardware. | Same. | Yes. Only the mark. | https://developer.apple.com/design/human-interface-guidelines/app-icons |

## Branding

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Use a consistent brand voice. | Our house rules define it. | House rules set the voice: short, plain, sentence case. | https://developer.apple.com/design/human-interface-guidelines/branding |
| Apply the accent color judiciously: on primary actions or status, such as unread badges or the selected tab icon. Consider moving brand color into the content layer, where it scrolls beneath glass. | Use the brand accent for done state and the one primary action. Keep chrome neutral. | Partly. Chartreuse marks done, today, the selected tab and the primary button. Chrome stays ink and ivory. | https://developer.apple.com/design/human-interface-guidelines/branding |
| A custom font must be legible at all sizes and support Bold Text and Dynamic Type. A custom font for headings with system font for body can work well. | Figtree for all text is fine if it scales with Dynamic Type. | Yes. Figtree scales with Dynamic Type through the root. Bold Text is not supported. | https://developer.apple.com/design/human-interface-guidelines/branding |
| Express the brand through familiar components, keeping standard size, placement and behavior. | Glass tab bar at the bottom, sheets from the bottom, standard gestures. | Yes. A glass tab bar at the bottom, sheets from the bottom with a grabber, drag down to dismiss. | https://developer.apple.com/design/human-interface-guidelines/branding |
| Branding defers to content. Do not show the logo throughout the app unless it gives context. | A logo mark used as the loading indicator is branding in the UI; keep it small and brief. | Kept by product choice. The mark sits in the header and is the loading indicator. See What Deka does not apply. | https://developer.apple.com/design/human-interface-guidelines/branding |
| Do not use the launch screen for branding. | See Launching. | Launch images show only the ground and the centred mark. See Launching. | https://developer.apple.com/design/human-interface-guidelines/branding |
| Apple trademarks must not appear in the app name or images. | Same. | Yes. None. | https://developer.apple.com/design/human-interface-guidelines/branding |

## Inclusion

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Consider the tone of copy from many perspectives. Be clear, direct and respectful. | Same. | Yes. Direct and plain throughout. | https://developer.apple.com/design/human-interface-guidelines/inclusion |
| Address people as "you". Avoid "the user". Reserve "we" and "our" for the company or software. | Same. | Copy says you. "We" appears only in a VoiceOver label, "Where we are". | https://developer.apple.com/design/human-interface-guidelines/inclusion |
| Define technical terms or avoid them. Replace colloquial phrases with plain language. | Same. | Yes. "Deka" is the one coined term, defined on the intro screen. | https://developer.apple.com/design/human-interface-guidelines/inclusion |
| Be careful with humor; it is hard to translate and can irritate on repeat. | Keep repeated strings plain. | Yes. Repeated strings are plain, such as "Run done." | https://developer.apple.com/design/human-interface-guidelines/inclusion |
| Avoid unnecessary gender references in copy and imagery. | Same. | Yes. No gendered copy. | https://developer.apple.com/design/human-interface-guidelines/inclusion |
| Avoid stereotypes and assumptions in examples and defaults. | Check sample goals and prompts. | No default goals. Icons are guessed from the goal's name. | https://developer.apple.com/design/human-interface-guidelines/inclusion |
| Prepare for localization: dates, times and numbers follow the person's region. | Use `Intl.DateTimeFormat` and `Intl.NumberFormat` with the device locale. | Not applied. Dates use a fixed English month list, not `Intl`. Times use the native time picker. | https://developer.apple.com/design/human-interface-guidelines/inclusion |

# Patterns

## Onboarding

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Onboarding should be fast, fun and optional. It starts after launch, not during it. | Same. | One intro screen after launch, then straight into the chat. | https://developer.apple.com/design/human-interface-guidelines/onboarding |
| Teach through interactivity: let people try the real action. | Let the first chat message or first day be the tutorial. | Yes. The chat is the setup: "Tell Deka your goals." | https://developer.apple.com/design/human-interface-guidelines/onboarding |
| Prefer context specific tips near the relevant UI over one long flow. | Show a single hint beside the element it explains, once. | No tips. Hints sit in context, such as the day picker hint in the goal sheet. | https://developer.apple.com/design/human-interface-guidelines/onboarding |
| If a tutorial is skipped, do not show it again, but keep it findable later. | Store the skip in saved state. | Not applied. The intro has one button and shows once, stored as `seen`. | https://developer.apple.com/design/human-interface-guidelines/onboarding |
| Teach the app, not the device or system. | For a PWA, one short "Add to Home Screen" hint may be the exception, since the step is not obvious. | No Add to Home Screen hint. In Safari the login screen notes that the home screen app asks for the passcode once too. | https://developer.apple.com/design/human-interface-guidelines/onboarding |
| Postpone nonessential setup. Use sensible defaults. | Same. | Yes. Check in at 20:00 and a deka that starts today. | https://developer.apple.com/design/human-interface-guidelines/onboarding |
| Ask for permissions in context, when a feature first needs them, or explain in onboarding. | Request notification permission only after a clear user action; Safari requires a user gesture anyway. | No permissions asked, except the microphone, which the browser asks for on the first tap of the mic button. | https://developer.apple.com/design/human-interface-guidelines/onboarding |
| Let people use the app before asking for ratings or purchases. | Same. | Yes. No ratings or purchases. | https://developer.apple.com/design/human-interface-guidelines/onboarding |

## Loading

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| The best loading finishes before people notice it. | Cache the shell and data so tabs show saved content instantly. | Yes. A service worker opens the app from cache at once, and saved data draws before any network call. | https://developer.apple.com/design/human-interface-guidelines/loading |
| Show something as soon as possible, such as placeholder text, graphics or animation, and replace it as content arrives. | Render saved data first, then refresh. | Yes. Local data renders first, then the session check runs. | https://developer.apple.com/design/human-interface-guidelines/loading |
| Let people do other things while content loads. | Keep tabs and the composer usable during a slow request. | Tabs stay usable during a reply. A new message waits until the reply ends. | https://developer.apple.com/design/human-interface-guidelines/loading |
| Say that content is loading when it takes more than a moment or two. Use determinate progress when duration is known, indeterminate when not. | A logo animation as the only indicator counts as an indeterminate indicator. | The living ten dot mark shows at once while Deka replies. "Waking up" appears only if the server takes over 800 ms. | https://developer.apple.com/design/human-interface-guidelines/loading |
| Custom loading views suit games; standard indicators suit most apps. | A custom indicator is a deliberate departure; keep it clear that work is ongoing. | Kept by product choice: the living ten dot mark is the only indicator, indeterminate, always moving while work runs. | https://developer.apple.com/design/human-interface-guidelines/loading |

## Feedback

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Match the delivery to the significance: passive status for status, interruption only for things like data loss. | Toasts for routine outcomes, no alerts for them. | Yes. Toasts for routine changes. Alerts only for discard and import. | https://developer.apple.com/design/human-interface-guidelines/feedback |
| Make feedback accessible through several channels: color, text, sound, haptics. | Use text plus visual change. Announce toasts through an `aria-live` region. Safari has no Vibration API, so web haptics are mostly unavailable. | Text and a visual change, and toasts through `aria-live`. `navigator.vibrate` on check off, which iOS Safari ignores. | https://developer.apple.com/design/human-interface-guidelines/feedback |
| Put status feedback near the item it describes. | Show state on the row or day it affects. | Yes. State shows on the session icon, the day row and the plan card. | https://developer.apple.com/design/human-interface-guidelines/feedback |
| Use alerts only for critical, ideally actionable, information. | Same. | Yes. Two alerts, both for destructive actions. | https://developer.apple.com/design/human-interface-guidelines/feedback |
| Warn before unexpected, irreversible data loss. Do not warn when loss is the expected result of the action. | Deleting with an Undo toast needs no warning. | Deletes act at once with Undo. Discard and import replace data, so they ask first. | https://developer.apple.com/design/human-interface-guidelines/feedback |
| Confirm completion only for significant tasks; people expect success and need to know about failure. | Keep success feedback quiet; make failure clear. | Success is a short toast. Failure shows under the reply with Try again. | https://developer.apple.com/design/human-interface-guidelines/feedback |
| When a command cannot run, say why. | Same. | Partly. Errors name the cause, such as offline or too many messages. A stale plan says "Out of date. Ask Deka again." | https://developer.apple.com/design/human-interface-guidelines/feedback |
| Haptics (Playing haptics page): use system patterns by their documented meaning, use them consistently, do not overuse, and make them optional. | Mostly does not apply: Safari on iPhone does not support `navigator.vibrate`. | Not applied on iOS. One 8 ms vibrate on check off where supported. | https://developer.apple.com/design/human-interface-guidelines/playing-haptics |

## Entering data

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Get information from the system instead of asking. | Use device locale, time zone and date instead of asking. | Yes. Today's date, time and speech language come from the device. | https://developer.apple.com/design/human-interface-guidelines/entering-data |
| Be clear about the data needed: placeholder like "username@company.com" or a label like "Email". Prefill sensible defaults. | Same. | Short placeholders such as "Tell Deka your goals" and "Name it". A new goal starts with three spread days. | https://developer.apple.com/design/human-interface-guidelines/entering-data |
| Use secure fields for sensitive data. Never prepopulate a password field. | Use `type="password"` and the right `autocomplete` value so iCloud Keychain can fill it. | Yes. The passcode is `type="password"` with `autocomplete="current-password"` and is never prefilled. | https://developer.apple.com/design/human-interface-guidelines/entering-data |
| Offer choices instead of text entry when possible. | Use pickers or chips for fixed options. | Yes. A segmented type control, a times stepper, a day picker, an icon grid, and native date and time pickers. | https://developer.apple.com/design/human-interface-guidelines/entering-data |
| Support paste and drag and drop. | Do not block paste. | Yes. Paste is never blocked. | https://developer.apple.com/design/human-interface-guidelines/entering-data |
| Validate values as they are entered and give immediate feedback. | Same. | Add stays off until a name exists. The day picker hint updates as days are placed. | https://developer.apple.com/design/human-interface-guidelines/entering-data |
| Make Next or Continue available only once required data is present. | Disable the send or save button until there is input. | Yes. Send and Add stay off until there is text. | https://developer.apple.com/design/human-interface-guidelines/entering-data |

## Modality

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Present modally only when there is a clear benefit. | Use sheets for scoped tasks only. | Sheets only for a day, a goal and the More menu. | https://developer.apple.com/design/human-interface-guidelines/modality |
| Keep modal tasks simple, short and streamlined. Avoid an app within the app. If subviews are needed, give one path and no buttons that look like dismiss. | Same. | Yes. One screen per sheet, no nested flows. | https://developer.apple.com/design/human-interface-guidelines/modality |
| Always provide an obvious way to dismiss. On iOS people expect a button in the top toolbar, or a swipe down. | Every sheet needs a close button at the top plus swipe down. | Yes. A Close button at top right, plus drag down, a tap on the scrim, and Escape. | https://developer.apple.com/design/human-interface-guidelines/modality |
| If closing could lose user content, confirm and offer a way out, for example an action sheet with Save. | For unsent drafts, prefer keeping the draft over asking. | The composer keeps its draft. Goal edits save as you go, and closing shows Undo. | https://developer.apple.com/design/human-interface-guidelines/modality |
| Name the task with a title so people keep their place. | A short title at the top of each sheet. | Yes. Each sheet has a title: Day N, Edit, New goal, More. | https://developer.apple.com/design/human-interface-guidelines/modality |
| Dismiss one modal before showing another. Never show more than one alert at a time. | One sheet at a time. | Yes. One sheet at a time. | https://developer.apple.com/design/human-interface-guidelines/modality |

## Navigation

There is no standalone navigation pattern page in the current HIG. The slugs managing-navigation, going-back and navigation-bars all return 404.
Navigation guidance now lives in Tab bars, Toolbars (which cover the iOS navigation bar), Designing for iOS and Adopting Liquid Glass.

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Controls in the middle or bottom of the screen are easier to reach. Let people swipe to navigate back or act on a list row. | Keep main controls low. In standalone mode there is no browser back gesture unless we build one, so every pushed view needs a back control. | Main controls sit low. Past, Settings and a past chat have a Back button, and history state lets the back gesture close them. | https://developer.apple.com/design/human-interface-guidelines/designing-for-ios |
| Limit onscreen controls; keep secondary actions discoverable with minimal interaction. | Same. | Yes. The header holds one More button; Past and Settings live behind it. | https://developer.apple.com/design/human-interface-guidelines/designing-for-ios |
| Keep a clear navigation hierarchy, separate from content, with navigation in the glass layer above content. | Tab bar and composer float; content scrolls under them. | Yes. The tab bar and composer float on glass above content. | https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass |
| Use the standard Back and Close buttons with their standard symbols. Do not use a text label that says Back or Close. | Use a chevron for back and an x for close, each with an `aria-label`. | Partly. Close is an x with an `aria-label`. Back is a chevron with the word Back. | https://developer.apple.com/design/human-interface-guidelines/toolbars |
| Restore state on relaunch. | Store the current tab and scroll position; iOS may evict a standalone web app from memory. | Not applied. Data persists, but the tab and scroll position reset. The app opens on the chat at its newest message. | https://developer.apple.com/design/human-interface-guidelines/launching |

## Launching

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Launch instantly. People may not want to wait more than a couple of seconds. | Cache the shell with a service worker. Render from saved data before any network call. | Yes. One static HTML file with inline CSS and JS, fonts preloaded, opened from cache by a service worker. Lighthouse mobile performance 100 on launch. | https://developer.apple.com/design/human-interface-guidelines/launching |
| The launch screen should be nearly identical to the first screen. If the app first shows a solid color, the launch screen shows only that color. Match orientation and appearance. | In standalone mode, use a first paint with the same background color as the app, or `apple-touch-startup-image`. No flash between colors. | Yes. Launch images match the app ground, ivory or near black in dark, with the mark centred. | https://developer.apple.com/design/human-interface-guidelines/launching |
| No text on the launch screen. | Same. | Yes. No text on launch images. | https://developer.apple.com/design/human-interface-guidelines/launching |
| Do not advertise. No logos unless they are a fixed part of the first screen. | Do not show a logo splash on launch. | The launch images show the centred mark. The intro and login screens show the same mark; the chat does not. | https://developer.apple.com/design/human-interface-guidelines/launching |
| Restore previous state so people continue where they left off, including scroll position. | Same as Navigation. | Not applied. See Navigation. | https://developer.apple.com/design/human-interface-guidelines/launching |
| Launch in the device's current orientation if both are supported. | Portrait by default through the manifest is fine for a phone app. | The manifest sets no orientation. Launch images are portrait only. | https://developer.apple.com/design/human-interface-guidelines/launching |

## Settings

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Choose defaults that suit most people so no setup is needed. | Same. | Yes. Check in at 20:00, and a deka starts today. | https://developer.apple.com/design/human-interface-guidelines/settings |
| Minimize the number of settings. | Same. | Yes. Check in time, deka start date, export, import, discard and lock. | https://developer.apple.com/design/human-interface-guidelines/settings |
| Do not ask for what you can detect, for example whether Dark Mode is on. | Read media queries instead of asking. | Yes. Theme, motion and transparency come from media queries. | https://developer.apple.com/design/human-interface-guidelines/settings |
| Respect systemwide settings. Do not duplicate them, such as accessibility options, in your own settings. | No in app text size, theme or motion toggles. Follow the system. | Yes. No text size, theme or motion toggles. | https://developer.apple.com/design/human-interface-guidelines/settings |
| Put task specific options in the screen they affect. | Filters or sort options go on the tab, not in a settings screen. | Goal options live in the goal sheet. No filters or sorting. | https://developer.apple.com/design/human-interface-guidelines/settings |
| Adding to the system Settings app. | Does not apply. A web app cannot add entries to iOS Settings. | Not applied. A web app cannot. | https://developer.apple.com/design/human-interface-guidelines/settings |

## Undo and redo

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Help people predict what undo will do, for example "Undo Typing". | The toast should name the action: "Deleted. Undo". | Yes. Toasts name the change, such as "Run done.", "Goals updated." or "Schedule updated.", with Undo. | https://developer.apple.com/design/human-interface-guidelines/undo-and-redo |
| Show the result of undo. If the change is offscreen, bring it into view. | After undo, scroll to and briefly highlight the restored item. | Not applied. Undo redraws the screen but does not scroll to or highlight the item. | https://developer.apple.com/design/human-interface-guidelines/undo-and-redo |
| Allow multiple undos. Do not set needless limits. | Consider a stack, not only the last action. | Not applied. Only the latest change can be undone, from its toast. | https://developer.apple.com/design/human-interface-guidelines/undo-and-redo |
| Provide dedicated undo buttons only when necessary, with standard symbols. | An Undo action in a toast is our chosen pattern. | Yes. Undo is a text button in the toast. | https://developer.apple.com/design/human-interface-guidelines/undo-and-redo |
| Do not redefine the standard undo gestures: three finger swipe and shake. The undo alert title starts with "Undo " plus one or two words. | Safari handles shake to undo for text fields only. Our custom actions need their own undo, and must not break the native text undo. | Our undo lives in the toast. Native text undo in fields is untouched. | https://developer.apple.com/design/human-interface-guidelines/undo-and-redo |

# Components

## Tab bars

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Use a tab bar for navigation, not actions. Actions go in a toolbar. | Three tabs for Chat, Days and Goals. No action buttons inside the tab bar. | Yes. Chat, Days and Goals, and no actions. | https://developer.apple.com/design/human-interface-guidelines/tab-bars |
| Keep the tab bar visible across sections. Only a modal may cover it. | Do not hide the tab bar inside a tab. A sheet may cover it. | Shown on every tab and on Past and Settings. Hidden while the keyboard is up and on the login and intro screens. Sheets cover it. | https://developer.apple.com/design/human-interface-guidelines/tab-bars |
| Fewer tabs are easier to navigate. Avoid overflow tabs. | Three is well within limits. | Yes. Three tabs. | https://developer.apple.com/design/human-interface-guidelines/tab-bars |
| Do not disable or hide tab buttons when content is unavailable. Explain why a section is empty. | Empty tabs show an empty state, not a disabled tab. | Yes. Empty Days and Goals show an empty state with Open chat. | https://developer.apple.com/design/human-interface-guidelines/tab-bars |
| Include tab labels, single words where possible. On iPhone the icon sits above the label. | Apple expects labels. Icon only tabs need at least an `aria-label`. See Conflicts. | Not applied. Icon only tabs, each with an `aria-label`. See What Deka does not apply. | https://developer.apple.com/design/human-interface-guidelines/tab-bars |
| Prefer filled symbols or icons for tab bar icons. | Use filled Phosphor icons, at least for the selected tab. | Not applied. Selection shows as full ink, a tinted lens and a small chartreuse dot. | https://developer.apple.com/design/human-interface-guidelines/tab-bars |
| Badges are a red oval with white text, a number or an exclamation point. Reserve them for critical information. | Use sparingly, if at all. | Not applied. No badges. | https://developer.apple.com/design/human-interface-guidelines/tab-bars |
| Avoid a tab label color similar to content backgrounds. With colorful content, keep the tab bar monochrome. | Keep tab icons in ink; mark selection with weight or fill, and the accent only if it contrasts. | Icons are soft ink, full ink when selected. The chartreuse dot has an ink ring. | https://developer.apple.com/design/human-interface-guidelines/tab-bars |
| On iOS the tab bar floats above content at the bottom, on a Liquid Glass background that lets content peek through. | A floating, inset, pill shaped bar with `backdrop-filter`, above `env(safe-area-inset-bottom)`. | Yes. A glass capsule 62 px tall, inset 16 px from the sides, just above the home indicator. | https://developer.apple.com/design/human-interface-guidelines/tab-bars |
| A tab bar with an accessory can minimize on scroll down and move the accessory inline. Tapping a tab or scrolling to top restores it. | Optional pattern for the composer and tab bar pair. | Not applied. See What Deka does not apply. | https://developer.apple.com/design/human-interface-guidelines/tab-bars |
| Search can be a dedicated tab at the trailing end. | Not needed now. | Not applied. No search. | https://developer.apple.com/design/human-interface-guidelines/tab-bars |
| The page gives no iOS tab bar height; it points to design resources for icon sizes. Only tvOS states a height, 68 pt. | Choose a height that keeps each tab target at least 44x44 px. | 62 px tall with 4 px padding, so each tab is well over 44 px square. | https://developer.apple.com/design/human-interface-guidelines/tab-bars |

## Sheets

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| A sheet is for a scoped task closely related to the current context. | Same. | Yes. A day, a goal, or the More menu. | https://developer.apple.com/design/human-interface-guidelines/sheets |
| On iOS a sheet can be modal or nonmodal. A nonmodal sheet lets people act on the parent view while it is open. | Decide per sheet whether the page behind stays interactive. | All sheets are modal. The page behind is inert. | https://developer.apple.com/design/human-interface-guidelines/sheets |
| Standard buttons: Cancel or Close dismisses without saving. Done dismisses after saving. Back goes to a previous step and does not dismiss. Do not show all three together. | Pick one clear dismiss control per sheet. | One Close x per sheet. The goal sheet also ends with Done or Add. | https://developer.apple.com/design/human-interface-guidelines/sheets |
| If there is a Done button, pair it with Cancel or Back so completing is not the only exit. | Same. | Yes. Done and Add always sit with the Close x. | https://developer.apple.com/design/human-interface-guidelines/sheets |
| On iOS, Cancel goes on the leading edge of the top toolbar, Done on the trailing edge. | Close at top left or top right, used consistently. | Close is always at top right. Done and Add sit at the bottom. | https://developer.apple.com/design/human-interface-guidelines/sheets |
| Show one sheet at a time. Close the first before opening another. | Same. | Yes. One at a time. | https://developer.apple.com/design/human-interface-guidelines/sheets |
| Detents: large is fully expanded; medium is about half of the full height. Sheets support large by default. Only medium prevents full height. | Implement two rest heights: about half and full. | Tall sheets open at a medium detent, 60% of the screen, and drag up to large. Short sheets fit their content. | https://developer.apple.com/design/human-interface-guidelines/sheets |
| On iPhone, consider the medium detent for progressive disclosure. Skip it when content needs full height, like compose sheets. | Same. | A text field inside takes the sheet to large, so the new goal sheet goes large as its name field takes focus. | https://developer.apple.com/design/human-interface-guidelines/sheets |
| Include a grabber in a resizable sheet. It shows the sheet can resize, cycles detents on tap, and works with VoiceOver. | Add a grabber as a real button with an `aria-label` that toggles the height. | Partly. A grabber shows and drags, but it is not a button and does not work with VoiceOver. See What Deka does not apply. | https://developer.apple.com/design/human-interface-guidelines/sheets |
| Support swiping down to dismiss. If there are unsaved changes, confirm with an action sheet. | Drag down to dismiss, tracking the finger, plus the close button for accessibility. | A drag or quick flick down steps large to medium, then dismisses. No confirm, since edits save with Undo. | https://developer.apple.com/design/human-interface-guidelines/sheets |
| For complex or long flows, use a full screen modal instead of a sheet. | Same. | Yes. Past and Settings are full pages, not sheets. | https://developer.apple.com/design/human-interface-guidelines/sheets |
| With Liquid Glass, sheets have a larger corner radius, half sheets are inset from the display edges, and a full height sheet turns more opaque. | Inset the half height sheet, round it to match the display, and go opaque at full height. | Yes. Medium and fit sheets float inset 8 px on glass with 32 px corners; large meets the edges on a solid surface. | https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass |

## Buttons

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| A button needs a hit region of at least 44x44 pt. | 44x44 px minimum hit area on every button. | Yes. A browser test checks every control at 375, 390 and 430 px. | https://developer.apple.com/design/human-interface-guidelines/buttons |
| Leave space around buttons so they are visually distinct and easy to hit. | See the 12 pt and 24 pt padding guidance in Accessibility. | Hit areas stay 44 px; visible gaps are 4 to 8 px. | https://developer.apple.com/design/human-interface-guidelines/buttons |
| Always include a press state for custom buttons. | Use `:active` styles; add an empty `touchstart` listener if Safari skips `:active`. | Yes. Every control has a pressed state. | https://developer.apple.com/design/human-interface-guidelines/buttons |
| Use a prominent style for the most likely action. Keep prominent buttons to one or two per view. | One filled primary button per view. | Yes. One chartreuse primary per view, such as Confirm or Add. | https://developer.apple.com/design/human-interface-guidelines/buttons |
| Use style, not size, to mark the preferred choice among options. | Same size buttons in a set, with one styled as primary. | Yes. Confirm and Tweak share a size; Confirm is filled. | https://developer.apple.com/design/human-interface-guidelines/buttons |
| Pair familiar actions with familiar icons. Use text when a short label is clearer than an icon, starting with a verb. | Same. | Icons for send, mic, close, back and more. Text verbs elsewhere. | https://developer.apple.com/design/human-interface-guidelines/buttons |
| Roles: normal, primary, cancel, destructive. Destructive uses system red. Never give the primary role to a destructive action. | Delete is never the default or highlighted button. | Destructive actions are plain links, never primary, and not red. Delete goal needs a second tap within 3 seconds. | https://developer.apple.com/design/human-interface-guidelines/buttons |
| For actions that do not complete instantly, show an activity indicator inside the button, optionally with a changed label. | Show progress inside the send button during a request. | Not applied. Send turns off during a reply; the living mark in the reply shows the work. | https://developer.apple.com/design/human-interface-guidelines/buttons |

## Text fields

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Use a text field for small amounts of text; use a text view for more. | The chat composer is multi line, so a `textarea` that grows fits. | Yes. The composer is an autosizing `textarea` up to 152 px. Day notes use a textarea too. | https://developer.apple.com/design/human-interface-guidelines/text-fields |
| Show a hint as placeholder. Since it disappears while typing, a separate label can help. | Keep placeholders short; add an `aria-label` either way. | Short placeholders, and every field has a label for screen readers. | https://developer.apple.com/design/human-interface-guidelines/text-fields |
| Use secure fields for sensitive data. | `type="password"`. | Yes. The passcode. | https://developer.apple.com/design/human-interface-guidelines/text-fields |
| Match the field size to the expected text. | Same. | The goal name allows 40 characters. The composer grows with its text. | https://developer.apple.com/design/human-interface-guidelines/text-fields |
| Validate at the right time: email when leaving the field, username or password before leaving. | Same. | Only the passcode is checked, on submit. | https://developer.apple.com/design/human-interface-guidelines/text-fields |
| Show the right keyboard type. | Use `inputmode`, `type` and `enterkeyhint`, for example `enterkeyhint="send"`. | `enterkeyhint="send"` on the composer and `done` on the goal name. Native date and time inputs. | https://developer.apple.com/design/human-interface-guidelines/text-fields |
| On iOS, show a Clear button at the trailing end where useful. Use the leading end for purpose and the trailing end for extra functions. | Same. | Not applied. No clear buttons. | https://developer.apple.com/design/human-interface-guidelines/text-fields |
| No point size is given for field text on this page. | Web specific: Safari zooms the page when a focused field has text under 16 px. Use at least 16 px, ideally 17 px, in inputs. | Yes. 17 px text in every field, never under 16 px, so iOS does not zoom. | https://developer.apple.com/design/human-interface-guidelines/text-fields |

## Lists and tables

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Prefer lists for text; the row format is easy to scan. | The ten day list fits this. | Yes. Days is a list of ten rows. Goals and Settings are lists too. | https://developer.apple.com/design/human-interface-guidelines/lists-and-tables |
| Let people edit a list when it makes sense. People like to reorder even when they cannot add or remove. | Consider reordering goals. | Not applied. Goals cannot be reordered. | https://developer.apple.com/design/human-interface-guidelines/lists-and-tables |
| Give selection feedback. Navigation lists keep the selected row highlighted; option lists flash briefly and then show a checkmark. | Same. | Rows show a pressed state. Picked days fill with ink. | https://developer.apple.com/design/human-interface-guidelines/lists-and-tables |
| Keep row text succinct to limit truncation and wrapping. For long items, show titles and open details elsewhere. | Same. | Yes. Rows show a name and a count. Details open in a sheet. | https://developer.apple.com/design/human-interface-guidelines/lists-and-tables |
| A middle ellipsis can keep items distinct when text must be clipped. | Same. | Not applied. Text wraps instead. | https://developer.apple.com/design/human-interface-guidelines/lists-and-tables |
| Use a style that fits the data; grouped style uses headers, footers and extra space. | Same. | Plain lists with hairline separators, no grouped sections. | https://developer.apple.com/design/human-interface-guidelines/lists-and-tables |
| Use a disclosure indicator to drill in. An info button only reveals more about the row. | Use a chevron only on rows that open a new view. | Yes. Chevrons only in the More menu, where rows open a new page. | https://developer.apple.com/design/human-interface-guidelines/lists-and-tables |
| With Liquid Glass, lists have larger row height and padding, rounder section corners, and title style section headers instead of all caps. | Do not use all caps section headers. | Partly. Section labels are sentence case, but chat day separators and the type control are in capitals. | https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass |
| No row height number is stated on this page. | Rows must still hold a 44 px target and grow with text size. | Rows are 60 to 68 px with hairline separators, set as minimums so they grow with text. | https://developer.apple.com/design/human-interface-guidelines/lists-and-tables |

## Progress indicators

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Two kinds: determinate for known duration, indeterminate for unknown. All indicators are transient. | A logo animation is an indeterminate indicator; remove it as soon as work ends. Give it `role="status"` and a label so VoiceOver hears it. | The living mark is indeterminate and settles as soon as the reply ends. The reply is `aria-busy` with "Deka is thinking" for VoiceOver; full screen waits use `role="status"`. | https://developer.apple.com/design/human-interface-guidelines/progress-indicators |
| Prefer determinate when possible. Switch from indeterminate to determinate once duration is known. | If a step can report progress, show it. | Goal progress is determinate, as rings. Days show as a mini row of ten dots that fill as days pass. | https://developer.apple.com/design/human-interface-guidelines/progress-indicators |
| Report progress accurately. Showing 90 percent in five seconds and the last 10 percent in 5 minutes feels deceptive. | Same. | Yes. Rings show real sessions done out of target. | https://developer.apple.com/design/human-interface-guidelines/progress-indicators |
| Keep indicators moving; a still indicator reads as stalled. If a process stalls, say what happened and what to do. | Keep the loading animation running while waiting. Under reduced motion, keep a gentle change such as opacity. Show an error after a timeout. | The mark moves the whole time and breathes under Reduce Motion. A failed reply shows an error with Try again. No client timeout. | https://developer.apple.com/design/human-interface-guidelines/progress-indicators |
| Do not switch between the circular and bar styles. | Use one indicator style everywhere. | Yes. The mark is the only loading indicator. | https://developer.apple.com/design/human-interface-guidelines/progress-indicators |
| An optional description should be accurate and short. Avoid vague words like "loading". | Prefer no label, or a specific one. | Only "Waking up" and "Importing" appear as text. | https://developer.apple.com/design/human-interface-guidelines/progress-indicators |
| Show progress in a consistent location. | The logo mark should appear in the same place each time. | Yes. Inline after the reply text, or centred for a full screen wait. | https://developer.apple.com/design/human-interface-guidelines/progress-indicators |
| Let people halt processing when safe, with Cancel, and Pause if cancel loses work. | Allow stopping a long chat reply. | Not applied. A reply cannot be stopped. | https://developer.apple.com/design/human-interface-guidelines/progress-indicators |
| Refresh controls: update content automatically too; add a title only if it adds value, never to explain how to refresh. | Pull to refresh is optional; refresh on focus and on return to the app. | No pull to refresh. The app refreshes on return to the foreground and once a minute. | https://developer.apple.com/design/human-interface-guidelines/progress-indicators |

## Alerts

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| Use alerts sparingly, only for essential information and useful actions. | Same. | Yes. Two alerts in the whole app. | https://developer.apple.com/design/human-interface-guidelines/alerts |
| Do not use an alert only to inform. Show the information in context instead. | Use inline status or a toast. | Yes. Information shows as a toast or inline. | https://developer.apple.com/design/human-interface-guidelines/alerts |
| Do not alert for common, undoable actions, even destructive ones. Alert for uncommon destructive actions that cannot be undone. | Deletes with Undo need no alert. | Yes. Deletes and edits use Undo. Only discard and import ask. | https://developer.apple.com/design/human-interface-guidelines/alerts |
| Do not show an alert at launch. For problems like no network, show cached data and a quiet label. | Offline shows saved data and a small note. | Yes. Saved data shows, and offline messages show as waiting under a quiet note. | https://developer.apple.com/design/human-interface-guidelines/alerts |
| An alert has a title, optional message, and up to three buttons. | Same. | The browser `confirm()`: a message with Cancel and OK. | https://developer.apple.com/design/human-interface-guidelines/alerts |
| Titles must be specific; not "Error". No more than two lines. Complete sentence: sentence case with end punctuation. Fragment: title case without end punctuation. | See Conflicts: we use sentence case. | Both are sentence case questions: "Discard this deka? Past dekas stay." and "Replace everything on this device with this file?" | https://developer.apple.com/design/human-interface-guidelines/alerts |
| Button titles: one or two words, verbs tied to the alert text. Use "OK" only in informational alerts. Always use "Cancel" for cancel. Title case, no end punctuation. | Verbs like "Delete" or "Keep". See Conflicts on case. | Not applied. The browser sets the buttons to OK and Cancel. | https://developer.apple.com/design/human-interface-guidelines/alerts |
| The likely button goes on the trailing side of a row or top of a stack. Cancel goes leading or bottom. | Same. | Set by the browser. | https://developer.apple.com/design/human-interface-guidelines/alerts |
| Use destructive style for destructive actions people did not deliberately choose. Include Cancel. Never make Cancel the default. | Same. | Set by the browser. Neither alert marks its action as destructive. | https://developer.apple.com/design/human-interface-guidelines/alerts |
| On iOS, use an action sheet, not an alert, to offer choices about an intentional action. Avoid alerts that scroll. | Use a bottom sheet with choices. | Not applied. No action sheets. | https://developer.apple.com/design/human-interface-guidelines/alerts |
| Allow other ways to cancel, for example Escape on a keyboard. | Close on Escape. Native `window.confirm` looks foreign in standalone mode; build our own. | Not applied. The browser `confirm()` is used, not a custom sheet. Sheets close on Escape. | https://developer.apple.com/design/human-interface-guidelines/alerts |

## Toolbars

| Rule | For a web app on iPhone | Deka today | Source |
|---|---|---|---|
| A toolbar holds the view title, navigation controls and actions. A tab bar is only for moving between areas. | Keep actions out of the tab bar. | Yes. The header holds the wordmark or Back, and the More button. | https://developer.apple.com/design/human-interface-guidelines/toolbars |
| Avoid overcrowding. On iOS include only the most important items; put the rest in a More menu. | Same. | Yes. One button in the header. | https://developer.apple.com/design/human-interface-guidelines/toolbars |
| Reduce toolbar backgrounds and tinted controls. Let content inform the color, and use a scroll edge effect to separate bar and content. | A transparent top bar with a fade edge over content, not a solid band. | Not applied. The header is solid ivory, static, and scrolls away. | https://developer.apple.com/design/human-interface-guidelines/toolbars |
| Use standard components whose corner radii are concentric with the bar. Custom parts must match. | Match radii across the composer, its buttons and the tab bar. | Yes. The composer, its buttons and the tab bar are concentric. | https://developer.apple.com/design/human-interface-guidelines/toolbars |
| Titles: concise, a word or short phrase, under 15 characters. Do not use the app name as a title. | Titles like "Days" and "Goals". | Page titles are short, such as "Day 3", "Goals" and "Settings". The header shows the Deka wordmark on the main tabs. | https://developer.apple.com/design/human-interface-guidelines/toolbars |
| Use the standard Back and Close buttons with standard symbols, not text saying Back or Close. | Same as Navigation. | Partly. Close is an x. Back is a chevron with the word Back. | https://developer.apple.com/design/human-interface-guidelines/toolbars |
| Prefer simple symbols over text, except for actions like edit. Use system style symbols without borders. | Icon buttons without circle outlines, except where a glass capsule is the container. | Yes. Header icons have no outline. Only the stepper buttons carry a border. | https://developer.apple.com/design/human-interface-guidelines/toolbars |
| Use the prominent style for key actions such as Done or Submit. Only one primary action, on the trailing side. | In a sheet, one primary action at top right. | Not applied. Sheet actions sit at the bottom, not top right. | https://developer.apple.com/design/human-interface-guidelines/toolbars |
| Group items by function. Aim for a maximum of three groups. Keep text labeled actions separate from icon actions. | Same. | Yes. The header has two items at most. | https://developer.apple.com/design/human-interface-guidelines/toolbars |
| On iOS, a large title turns into a standard title as people scroll, and back to large at the top. | Optional: shrink the tab title on scroll. | Not applied. The header scrolls away and titles do not shrink. | https://developer.apple.com/design/human-interface-guidelines/toolbars |

# What Deka does not apply, and why

| Apple guidance | Why Deka does not apply it |
|---|---|
| Tab labels | The product owner chose icon only tabs, in line with our minimal words rule. Each tab has a VoiceOver label. |
| Title case | Deka uses sentence case everywhere. The Writing page allows one style per element if it is used consistently. |
| Tab bar that minimizes on scroll | Screens are short, and a fixed layer that changes size on scroll is fragile on iPhone. |
| SF Symbols | The license limits them to Apple platforms. Deka uses Phosphor instead. |
| Haptics | The web has no haptics on iOS. `navigator.vibrate` runs only where a browser supports it. |
| Alerts to confirm actions | Deka acts at once and offers Undo. Only discard and import still ask. |
| No timed elements | Toasts are kept, but they last 6 seconds and wait while touched or focused. |
| No logo in the UI | Branding advises against it. The living mark stays as the loading indicator by product choice. |
| A grabber that works with VoiceOver | The grabber is drag only. The sheet content scrolls, and every sheet has a Close button. |
| Detect standalone mode through display mode | Deka reads `navigator.standalone`, because the display mode query is not reliable in all WebKit versions. |

# Conflicts with our rules

Our house rules win in every case below.

| Apple guidance | Our rule | Result |
|---|---|---|
| Button titles use title style capitalization (Buttons, Alerts). Alert titles that are fragments use title case. Lists and tables use title style column headings and section headers. | Sentence case, minimal words. | We use sentence case for buttons, titles, headers and alerts. Writing allows choosing a style per element if it is consistent, so this is a defensible choice. |
| Tab bars should include labels, single words where possible. | Minimal words; our tab bar has three icon tabs. | We keep icon only tabs, with an `aria-label` on each. Filled icons and clear selection states must make them readable. |
| Longer explanatory copy: alert messages in complete sentences, settings explanations, empty states that "educate", onboarding tips, refresh titles. | Minimal words, short simple sentences, no orphan word on the last line. | Keep only what the person needs. One short line per empty state or message. Balance line breaks, for example with `text-wrap: balance` or a non breaking space before the last word. |
| Alerts can confirm an important action or purchase, and Feedback suggests confirming significant completed tasks. Modality asks for confirmation before closing a view with user content. Assistive Access asks for confirmation twice before hard to recover actions. | Act at once and offer Undo in a toast. | We do not confirm. We act, show a toast with Undo, and keep undo reliable. Apple itself says not to alert for common, undoable actions. |
| Alert example copy uses "OK", "Yes", "No" and phrases like "Get Started". | Minimal words. | Use one verb that names the result. |
| Apple copy style uses em dashes and hyphenated compounds in running text. | No em dashes, en dashes, or hyphens used as punctuation. | Use commas, colons or full stops. |
| Accessibility asks to minimize time boxed elements that auto dismiss. | Toasts with Undo that disappear. | Not strictly a house rule conflict, but a tension. Keep Undo toasts visible long enough, pause them on touch or focus, and let undo work another way too. |
| Standard loading uses system progress indicators; Branding says to keep the logo out of the UI unless it gives context. | The living logo mark is our only loading indicator. | We keep the logo indicator. It must behave like an indeterminate indicator: consistent place, always moving, gone when done, accessible label, calm under reduced motion. |

# Sources

JSON sources were fetched from `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<slug>.json` on 2026-09-23.
The human readable pages are listed below.

1. https://developer.apple.com/design/human-interface-guidelines/accessibility
2. https://developer.apple.com/design/human-interface-guidelines/color
3. https://developer.apple.com/design/human-interface-guidelines/dark-mode
4. https://developer.apple.com/design/human-interface-guidelines/layout
5. https://developer.apple.com/design/human-interface-guidelines/materials
6. https://developer.apple.com/design/human-interface-guidelines/motion
7. https://developer.apple.com/design/human-interface-guidelines/typography
8. https://developer.apple.com/design/human-interface-guidelines/writing
9. https://developer.apple.com/design/human-interface-guidelines/icons
10. https://developer.apple.com/design/human-interface-guidelines/sf-symbols
11. https://developer.apple.com/design/human-interface-guidelines/app-icons
12. https://developer.apple.com/design/human-interface-guidelines/branding
13. https://developer.apple.com/design/human-interface-guidelines/inclusion
14. https://developer.apple.com/design/human-interface-guidelines/onboarding
15. https://developer.apple.com/design/human-interface-guidelines/loading
16. https://developer.apple.com/design/human-interface-guidelines/feedback
17. https://developer.apple.com/design/human-interface-guidelines/playing-haptics
18. https://developer.apple.com/design/human-interface-guidelines/entering-data
19. https://developer.apple.com/design/human-interface-guidelines/modality
20. https://developer.apple.com/design/human-interface-guidelines/launching
21. https://developer.apple.com/design/human-interface-guidelines/settings
22. https://developer.apple.com/design/human-interface-guidelines/undo-and-redo
23. https://developer.apple.com/design/human-interface-guidelines/searching
24. https://developer.apple.com/design/human-interface-guidelines/designing-for-ios
25. https://developer.apple.com/design/human-interface-guidelines/tab-bars
26. https://developer.apple.com/design/human-interface-guidelines/sheets
27. https://developer.apple.com/design/human-interface-guidelines/buttons
28. https://developer.apple.com/design/human-interface-guidelines/text-fields
29. https://developer.apple.com/design/human-interface-guidelines/lists-and-tables
30. https://developer.apple.com/design/human-interface-guidelines/progress-indicators
31. https://developer.apple.com/design/human-interface-guidelines/alerts
32. https://developer.apple.com/design/human-interface-guidelines/toolbars
33. https://developer.apple.com/documentation/technologyoverviews/liquid-glass
34. https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
35. Index pages used to find slugs: https://developer.apple.com/design/human-interface-guidelines, and the foundations, patterns, components, navigation-and-search and presentation index pages under the same path.

These slugs returned 404 and have no page: managing-navigation, going-back, navigation-bars.
