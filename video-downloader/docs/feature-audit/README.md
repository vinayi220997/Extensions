# VidPull feature audit (v3.1.2)

All 719 features from `video_downloader_extension_complete_feature_list.md` were checked against the VidPull 3.1.2 source code and test suites (3 Nov 2026). Each missing or partial feature has a **usefulness score** from 1 to 10 (10 = most useful to build for VidPull users) and a rough **effort**: S = hours, M = a day or two, L = a week or more.

Files in this folder:

- `feature-audit.html`: interactive checklist with filters, sorting and search. Download it and open it in a browser.
- `feature-audit.csv`: the full checklist for Excel or Google Sheets.
- `feature-list.md`: the original feature list that was audited.

## Summary

| Status | Features | Share |
|---|---|---|
| Available | 280 | 39% |
| Partial | 124 | 17% |
| Not available | 315 | 44% |
| **Unavailable in total** | **439** | 61% |

## Most useful to build (score 7 and up)

Related items from the list are grouped into one improvement each.

| Score | Improvement | What VidPull has today | Effort |
|---|---|---|---|
| 9 | Batch download / “Download all” | Only from Saved links | M |
| 8 | Download speed (MB/s) and time left | Bytes only | S |
| 8 | Subtitles (detect and save .srt/.vtt) | Subtitle tracks are skipped | M |
| 8 | Built-in support for popular sites (Vimeo, Reddit, X, Facebook, Instagram, Dailymotion) | General detection only | L |
| 7 | Download button on each video (hover overlay) | Page sidebar only | M |
| 7 | Folders by site and date (`VidPull/{host}/{date}`) | One fixed folder | S |
| 7 | “Already downloaded” warning | Same job isn't started twice; no warning | S |
| 7 | MP3 audio | M4A/AAC only | M |
| 7 | Video Picture-in-Picture | Only VidPull's own panel floats | S |

Scored low on purpose (1–3): torrent download and torrent bookmarks (outside a video downloader's job), all 20 AI features (need a paid AI service or a large local model), nested bookmark folders, and a React/TypeScript rewrite.

## By section

| Section | Available | Partial | Not available |
|---|---|---|---|
| 1. Core Features | 22 | 2 | 1 |
| 2. Video Detection Features | 23 | 4 | 1 |
| 3. Download Management | 14 | 5 | 12 |
| 4. Video Quality And Format | 17 | 12 | 6 |
| 5. Smart Features | 16 | 5 | 8 |
| 6. Advanced Download Engine | 8 | 3 | 8 |
| 7. Advanced Stream Support | 8 | 4 | 2 |
| 8. Smart Download Rules | 10 | 3 | 4 |
| 9. Ai-Powered Features | 0 | 0 | 20 |
| 10. Popup Dashboard Ui | 17 | 0 | 1 |
| 11. Download Manager Dashboard | 13 | 4 | 6 |
| 12. Settings Dashboard | 12 | 5 | 1 |
| 13. Privacy And Security | 8 | 8 | 2 |
| 14. Website Compatibility | 9 | 6 | 0 |
| 15. Notifications And Automation | 4 | 1 | 11 |
| 16. Statistics And Analytics | 0 | 0 | 20 |
| 17. Premium / Pro Features | 6 | 6 | 6 |
| 18. Unique Differentiating Features | 9 | 10 | 4 |
| 19. Additional Professional Features | 7 | 3 | 10 |
| 20. Technical Architecture | 17 | 1 | 8 |
| 21. Development Roadmap | 17 | 5 | 6 |
| 22. Torrent Download Features | 0 | 0 | 25 |
| 23. Picture-In-Picture (Pip) View | 0 | 0 | 26 |
| 24. Torrent Saver / Torrent Bookmark Manager | 0 | 0 | 30 |
| 25. Bookmark Folder Management | 7 | 3 | 35 |
| 26. Advanced Bookmark Features | 15 | 6 | 14 |
| 27. Advanced Folder Experience | 3 | 3 | 20 |
| 28. Media Library Organization | 2 | 10 | 10 |
| 29. Extra Productivity Features | 7 | 4 | 13 |
| 30. Recommended Main Navigation | 9 | 11 | 5 |

## All unavailable features, highest score first

| Score | Effort | Status | Feature | Section | Notes |
|---|---|---|---|---|---|
| 9 | M | Partial | Batch download | 1. Core Features | Download from Saved links list; no ‘Download all’ / multi-select on the media list |
| 9 | M | Not available | Download all button | 10. Popup Dashboard Ui | Not built |
| 9 | M | Partial | Bulk actions | 11. Download Manager Dashboard | Download from Saved links list; no ‘Download all’ / multi-select on the media list |
| 9 | M | Partial | Batch downloads | 21. Development Roadmap · Phase 2 – Advanced | Download from Saved links list; no ‘Download all’ / multi-select on the media list |
| 8 | S | Not available | Download speed indicator | 1. Core Features | Bytes are shown but not MB/s |
| 8 | S | Not available | Download speed indicators | 11. Download Manager Dashboard | Bytes are shown but not MB/s |
| 8 | L | Partial | Authorized video hosting compatibility | 14. Website Compatibility | Generic detection; no site-specific extractors (Vimeo, Reddit, X…) |
| 8 | M | Not available | Subtitle track detection | 2. Video Detection Features | Subtitle tracks are skipped |
| 8 | M | Not available | Subtitle track identification | 7. Advanced Stream Support | Subtitle tracks are skipped |
| 7 | S | Not available | Remaining time estimation | 11. Download Manager Dashboard | Not built |
| 7 | L | Partial | Website-specific detection rules | 14. Website Compatibility | Rule/script addons let you add them; none built in |
| 7 | L | Partial | Custom website compatibility settings | 14. Website Compatibility | Rule/script addons let you add them; none built in |
| 7 | S | Not available | Duplicate video warning | 15. Notifications And Automation | Not built |
| 7 | M | Partial | Smart floating download button | 18. Unique Differentiating Features | Page sidebar + edge handle; no button on top of each video |
| 7 | S | Partial | Download folder templates | 18. Unique Differentiating Features | One fixed subfolder; no {host}/{date} folders |
| 7 | M | Not available | Subtitle management | 21. Development Roadmap · Phase 3 – Smart | Not built |
| 7 | S | Not available | Picture-in-Picture mode | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 7 | S | Partial | Duplicate download prevention | 3. Download Management | Same job isn't started twice; no warning when the file was downloaded before |
| 7 | S | Partial | Download folder organization | 3. Download Management | One fixed subfolder; no {host}/{date} folders |
| 7 | S | Not available | Download time estimation | 3. Download Management | Not built |
| 7 | M | Not available | MP3 extraction | 4. Video Quality And Format | Audio saved as M4A/AAC (no MP3 encoder) |
| 7 | M | Not available | Subtitle extraction | 4. Video Quality And Format | Not built |
| 7 | M | Partial | Floating download button | 5. Smart Features | Page sidebar + edge handle; no button on top of each video |
| 7 | M | Partial | Download button overlay | 5. Smart Features | Page sidebar + edge handle; no button on top of each video |
| 7 | M | Partial | Automatic overlay visibility | 5. Smart Features | Page sidebar + edge handle; no button on top of each video |
| 7 | S | Partial | Automatically skip duplicate files | 8. Smart Download Rules | Same job isn't started twice; no warning when the file was downloaded before |
| 7 | S | Partial | Automatically organize files by website | 8. Smart Download Rules | One fixed subfolder; no {host}/{date} folders |
| 7 | S | Partial | Automatically create folders by date | 8. Smart Download Rules | One fixed subfolder; no {host}/{date} folders |
| 6 | S | Not available | Pause all | 11. Download Manager Dashboard | Not built |
| 6 | S | Not available | Resume all | 11. Download Manager Dashboard | Not built |
| 6 | S | Not available | Cancel all | 11. Download Manager Dashboard | Not built |
| 6 | M | Partial | Compatibility diagnostics | 14. Website Compatibility | DRM/MSE notices + provider notice; no full diagnostic report |
| 6 | M | Partial | Unsupported website notifications | 14. Website Compatibility | DRM/MSE notices + provider notice; no full diagnostic report |
| 6 | L | Not available | AI subtitles | 17. Premium / Pro Features | Needs an AI service (API key/cost) or a large local model |
| 6 | M | Partial | Multiple audio track detection | 2. Video Detection Features | HLS alternate audio + DASH audio reps listed as ‘Audio only · name’; no language switcher |
| 6 | L | Not available | AI subtitles | 21. Development Roadmap · Phase 4 – Premium | Needs an AI service (API key/cost) or a large local model |
| 6 | M | Not available | Floating video player | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 6 | S | Not available | Always-on-top video window | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 6 | M | Not available | Auto PIP when switching tabs | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 6 | M | Not available | PIP support for compatible video websites | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 6 | S | Not available | Pause all downloads | 3. Download Management | Not built |
| 6 | S | Not available | Resume all downloads | 3. Download Management | Not built |
| 6 | S | Not available | Cancel all downloads | 3. Download Management | Not built |
| 6 | M | Partial | Picture-in-Picture | 30. Recommended Main Navigation | Panel can float; no video PiP |
| 6 | S | Not available | Website whitelist | 5. Smart Features | Not built |
| 6 | S | Not available | Website blacklist | 5. Smart Features | Not built |
| 6 | M | Partial | Separate audio stream identification | 7. Advanced Stream Support | HLS alternate audio + DASH audio reps listed as ‘Audio only · name’; no language switcher |
| 6 | M | Partial | Multiple audio track detection | 7. Advanced Stream Support | HLS alternate audio + DASH audio reps listed as ‘Audio only · name’; no language switcher |
| 6 | M | Not available | Language track selection | 7. Advanced Stream Support | Not built |
| 6 | M | Partial | Supported stream diagnostics | 7. Advanced Stream Support | DRM/MSE notices + provider notice; no full diagnostic report |
| 6 | M | Not available | Automatically select preferred audio language | 8. Smart Download Rules | Not built |
| 6 | L | Not available | AI subtitle generation | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 6 | L | Not available | AI speech transcription | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 5 | S | Not available | Retry all failed | 11. Download Manager Dashboard | Not built |
| 5 | M | Partial | Website permissions | 12. Settings Dashboard | Uses all-sites access; per-site rules, no per-site on/off |
| 5 | S | Partial | Maximum concurrent downloads | 12. Settings Dashboard | Segment concurrency is configurable; number of parallel jobs is not |
| 5 | M | Partial | Website permission management | 13. Privacy And Security | Uses all-sites access; per-site rules, no per-site on/off |
| 5 | S | Not available | Transparent privacy policy | 13. Privacy And Security | Needed for Chrome Web Store listing |
| 5 | M | Partial | Website access controls | 13. Privacy And Security | Uses all-sites access; per-site rules, no per-site on/off |
| 5 | M | Partial | Website permission indicators | 14. Website Compatibility | Uses all-sites access; per-site rules, no per-site on/off |
| 5 | M | Partial | Advanced download automation | 17. Premium / Pro Features | Global + per-site ‘Always’ actions; no rule builder/presets |
| 5 | M | Partial | Advanced batch management | 17. Premium / Pro Features | Not built |
| 5 | M | Partial | Advanced download rules | 17. Premium / Pro Features | Global + per-site ‘Always’ actions; no rule builder/presets |
| 5 | L | Partial | Advanced media library | 17. Premium / Pro Features | Saved links (videos/pages, categories, notes, link check); no full library |
| 5 | M | Partial | Advanced organization tools | 17. Premium / Pro Features | Not built |
| 5 | L | Partial | Personal video library | 18. Unique Differentiating Features | Saved links (videos/pages, categories, notes, link check); no full library |
| 5 | L | Partial | Video collection management | 18. Unique Differentiating Features | Saved links (videos/pages, categories, notes, link check); no full library |
| 5 | L | Partial | Favorite video collections | 18. Unique Differentiating Features | Saved links (videos/pages, categories, notes, link check); no full library |
| 5 | M | Partial | Download presets | 18. Unique Differentiating Features | Global + per-site ‘Always’ actions; no rule builder/presets |
| 5 | M | Partial | Custom download profiles | 18. Unique Differentiating Features | Global + per-site ‘Always’ actions; no rule builder/presets |
| 5 | L | Partial | Smart storage manager | 18. Unique Differentiating Features | Saved links (videos/pages, categories, notes, link check); no full library |
| 5 | L | Not available | Multi-language UI | 19. Additional Professional Features | English only |
| 5 | L | Not available | Localization support | 19. Additional Professional Features | English only |
| 5 | M | Not available | Onboarding experience | 19. Additional Professional Features | Not built |
| 5 | M | Not available | Interactive product tutorial | 19. Additional Professional Features | Not built |
| 5 | M | Partial | Memory usage optimization | 19. Additional Professional Features | Streams to disk in chunks; large HLS still buffered in memory before saving |
| 5 | M | Partial | Download automation rules | 21. Development Roadmap · Phase 3 – Smart | Global + per-site ‘Always’ actions; no rule builder/presets |
| 5 | L | Partial | Advanced media library | 21. Development Roadmap · Phase 4 – Premium | Saved links (videos/pages, categories, notes, link check); no full library |
| 5 | M | Not available | Mini video player | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 5 | S | Not available | Playback speed control | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 5 | M | Not available | Auto PIP mode | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 5 | S | Partial | Configurable download concurrency | 3. Download Management | Segment concurrency is configurable; number of parallel jobs is not |
| 5 | L | Not available | Multi-language support | 5. Smart Features | English only |
| 5 | M | Not available | First-time user tutorial | 5. Smart Features | Not built |
| 5 | L | Not available | AI subtitle translation | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 4 | S | Partial | Custom download location | 1. Core Features | Subfolder inside Downloads + ‘Save as’ dialog; can't pick an arbitrary folder (Chrome limit) |
| 4 | S | Partial | Queued downloads section | 11. Download Manager Dashboard | One list with status per card; no separate sections |
| 4 | S | Partial | Completed downloads section | 11. Download Manager Dashboard | One list with status per card; no separate sections |
| 4 | S | Partial | Failed downloads section | 11. Download Manager Dashboard | One list with status per card; no separate sections |
| 4 | S | Not available | Privacy settings | 12. Settings Dashboard | No incognito/private mode option (history can be turned off) |
| 4 | S | Partial | Default download folder | 12. Settings Dashboard | Subfolder inside Downloads + ‘Save as’ dialog; can't pick an arbitrary folder (Chrome limit) |
| 4 | S | Not available | Privacy mode | 13. Privacy And Security | No incognito/private mode option (history can be turned off) |
| 4 | S | Partial | Clear extension data | 13. Privacy And Security | Clear history/list/saved links + history days; no single ‘erase everything’ |
| 4 | S | Partial | User-controlled data retention | 13. Privacy And Security | Clear history/list/saved links + history days; no single ‘erase everything’ |
| 4 | S | Not available | Total downloads | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 4 | S | Not available | Total downloaded size | 16. Statistics And Analytics | No statistics screen |
| 4 | L | Not available | Additional format and conversion options | 17. Premium / Pro Features | Needs ffmpeg.wasm (~30 MB) or the helper app |
| 4 | L | Not available | AI video summaries | 17. Premium / Pro Features | Needs an AI service (API key/cost) or a large local model |
| 4 | M | Not available | Smart duplicate finder | 18. Unique Differentiating Features | Not built |
| 4 | M | Partial | Video compatibility checker | 18. Unique Differentiating Features | Shows DRM/live/separate-audio limits; no ‘will it play on my device’ check |
| 4 | M | Partial | Screen reader accessibility | 19. Additional Professional Features | ARIA labels on controls; not tested with a screen reader |
| 4 | S | Partial | Frame rate detection | 2. Video Detection Features | Parsed from HLS FRAME-RATE, not shown in UI |
| 4 | M | Partial | Media compatibility detection | 2. Video Detection Features | Shows DRM/live/separate-audio limits; no ‘will it play on my device’ check |
| 4 | L | Not available | AI video summaries | 21. Development Roadmap · Phase 4 – Premium | Needs an AI service (API key/cost) or a large local model |
| 4 | S | Not available | Play and pause controls | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 4 | S | Not available | Seek forward and backward | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 4 | S | Not available | Keyboard shortcuts | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 4 | S | Not available | Return to original tab | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 4 | S | Partial | Create bookmark folders | 25. Bookmark Folder Management | Saved links has flat categories (create, rename, colour, delete) |
| 4 | S | Partial | Rename folders | 25. Bookmark Folder Management | Saved links has flat categories (create, rename, colour, delete) |
| 4 | S | Partial | Delete folders | 25. Bookmark Folder Management | Saved links has flat categories (create, rename, colour, delete) |
| 4 | M | Partial | Video folders | 28. Media Library Organization | Saved links: video & page lists with categories, search, details |
| 4 | M | Partial | Website bookmarks | 28. Media Library Organization | Saved links: video & page lists with categories, search, details |
| 4 | M | Partial | Personal collections | 28. Media Library Organization | Saved links: video & page lists with categories, search, details |
| 4 | S | Not available | Favorite media | 28. Media Library Organization | Saved links has categories but no ★ favourites |
| 4 | M | Partial | Saved videos | 28. Media Library Organization | Saved links: video & page lists with categories, search, details |
| 4 | M | Partial | Custom collections | 28. Media Library Organization | Saved links: video & page lists with categories, search, details |
| 4 | M | Partial | Media search | 28. Media Library Organization | Saved links: video & page lists with categories, search, details |
| 4 | M | Partial | Media filtering | 28. Media Library Organization | Saved links: video & page lists with categories, search, details |
| 4 | M | Partial | Media metadata viewer | 28. Media Library Organization | Saved links: video & page lists with categories, search, details |
| 4 | M | Not available | Duplicate media detection | 28. Media Library Organization | Not built |
| 4 | M | Partial | Global search | 29. Extra Productivity Features | Search per screen (media, downloads, history, saved) |
| 4 | S | Not available | Undo delete | 29. Extra Productivity Features | Deletes ask for confirmation; no undo |
| 4 | S | Not available | Recently deleted items | 29. Extra Productivity Features | Deletes ask for confirmation; no undo |
| 4 | S | Not available | Trash folder | 29. Extra Productivity Features | Deletes ask for confirmation; no undo |
| 4 | S | Not available | Restore deleted bookmarks | 29. Extra Productivity Features | Deletes ask for confirmation; no undo |
| 4 | S | Not available | Export download history | 3. Download Management | Backup has settings/rules/addons/saved links, not history |
| 4 | S | Not available | Import download history | 3. Download Management | Backup has settings/rules/addons/saved links, not history |
| 4 | M | Partial | File integrity verification | 3. Download Management | Segment errors, >35%-bad abort, size checks; no checksum/playback verification |
| 4 | M | Partial | Incomplete download detection | 3. Download Management | Segment errors, >35%-bad abort, size checks; no checksum/playback verification |
| 4 | M | Partial | Media Library | 30. Recommended Main Navigation | Saved links |
| 4 | M | Partial | Codec selection | 4. Video Quality And Format | Codecs shown per quality; no codec preference |
| 4 | L | Not available | Video compression | 4. Video Quality And Format | Needs ffmpeg.wasm (~30 MB) or the helper app |
| 4 | L | Not available | Video conversion | 4. Video Quality And Format | Needs ffmpeg.wasm (~30 MB) or the helper app |
| 4 | M | Partial | Video quality comparison | 4. Video Quality And Format | Codecs shown per quality; no codec preference |
| 4 | S | Not available | Favorite videos | 5. Smart Features | Saved links has categories but no ★ favourites |
| 4 | M | Not available | Download statistics | 5. Smart Features | Not built |
| 4 | M | Not available | Daily download count | 5. Smart Features | Not built |
| 4 | M | Not available | Total downloaded storage | 5. Smart Features | Not built |
| 4 | M | Partial | Incomplete download detection | 6. Advanced Download Engine | Segment errors, >35%-bad abort, size checks; no checksum/playback verification |
| 4 | M | Partial | File integrity checking | 6. Advanced Download Engine | Segment errors, >35%-bad abort, size checks; no checksum/playback verification |
| 4 | M | Partial | Corrupted media detection | 6. Advanced Download Engine | Segment errors, >35%-bad abort, size checks; no checksum/playback verification |
| 4 | M | Partial | Media compatibility reporting | 7. Advanced Stream Support | Shows DRM/live/separate-audio limits; no ‘will it play on my device’ check |
| 4 | M | Not available | Automatically select subtitle language | 8. Smart Download Rules | Not built |
| 4 | L | Not available | AI video summarization | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 3 | S | Partial | Notification settings | 12. Settings Dashboard | On/off only |
| 3 | M | Partial | Minimal browser permissions | 13. Privacy And Security | Needs broad host access to detect video; userScripts optional |
| 3 | S | Partial | Clear permission explanations | 13. Privacy And Security | Help explains some; no dedicated permissions page |
| 3 | S | Partial | Secure error logging | 13. Privacy And Security | Console warnings only; no log export |
| 3 | M | Partial | Permission audit | 13. Privacy And Security | Needs broad host access to detect video; userScripts optional |
| 3 | S | Not available | Download queue completed notification | 15. Notifications And Automation | Not built |
| 3 | M | Not available | Scheduled download reminders | 15. Notifications And Automation | Not built |
| 3 | S | Partial | Custom notification preferences | 15. Notifications And Automation | On/off only |
| 3 | S | Not available | Download completion actions | 15. Notifications And Automation | e.g. open file / show folder automatically |
| 3 | M | Not available | Successful downloads | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Failed downloads | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Average download speed | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Fastest download speed | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Daily download statistics | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Weekly download statistics | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Monthly download statistics | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Yearly download statistics | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Most frequently used websites | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Most downloaded resolutions | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Download format distribution | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Download history timeline | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Storage usage chart | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Download success rate | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Download failure rate | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Average download duration | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Bandwidth usage chart | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Download activity chart | 16. Statistics And Analytics | No statistics screen (History has the raw data) |
| 3 | M | Not available | Advanced analytics | 17. Premium / Pro Features | No statistics screen (History has the raw data) |
| 3 | M | Partial | Smart quality recommendation | 18. Unique Differentiating Features | Picks your default quality; no recommendation logic |
| 3 | M | Not available | Download intelligence dashboard | 18. Unique Differentiating Features | No statistics screen (History has the raw data) |
| 3 | M | Not available | Recent webpage video scanner | 18. Unique Differentiating Features | Detected lists are per open tab only |
| 3 | S | Not available | Extension update notifications | 19. Additional Professional Features | Not built |
| 3 | S | Not available | Changelog viewer | 19. Additional Professional Features | Not built |
| 3 | S | Not available | Feedback submission | 19. Additional Professional Features | Not built |
| 3 | S | Not available | Bug reporting | 19. Additional Professional Features | Not built |
| 3 | L | Not available | Browser compatibility checks | 19. Additional Professional Features | Chrome/Edge only; no Firefox build |
| 3 | M | Partial | User preference synchronization where supported | 19. Additional Professional Features | Settings sync via Chrome sync; history/saved links stay local |
| 3 | S | Partial | Video bitrate detection | 2. Video Detection Features | Bandwidth parsed (used for size estimate), not shown as a number |
| 3 | S | Partial | Logging system | 20. Technical Architecture | Not built |
| 3 | M | Not available | Unit testing | 20. Technical Architecture | Browser-level tests only |
| 3 | L | Not available | Browser compatibility testing | 20. Technical Architecture | Chrome/Edge only; no Firefox build |
| 3 | M | Partial | Video categorization | 21. Development Roadmap · Phase 3 – Smart | Saved-link categories only |
| 3 | M | Not available | Advanced statistics | 21. Development Roadmap · Phase 3 – Smart | No statistics screen (History has the raw data) |
| 3 | M | Not available | Advanced analytics | 21. Development Roadmap · Phase 4 – Premium | No statistics screen (History has the raw data) |
| 3 | S | Not available | Magnet link recognition | 22. Torrent Download Features | Could be detected on pages and handed to your torrent app |
| 3 | S | Not available | Magnet link copy | 22. Torrent Download Features | Could be detected on pages and handed to your torrent app |
| 3 | S | Not available | .torrent file recognition | 22. Torrent Download Features | Could be detected on pages and handed to your torrent app |
| 3 | S | Not available | Resizable floating player | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 3 | S | Not available | Draggable floating player | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 3 | S | Not available | Volume control | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 3 | S | Not available | Mute and unmute | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 3 | S | Not available | Video progress bar | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 3 | M | Not available | Remember last playback position | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 3 | M | Not available | Auto PIP when minimizing browser | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 3 | M | Not available | PIP background controls | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 3 | S | Not available | Close floating player | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 3 | M | Not available | Nest folders inside folders | 25. Bookmark Folder Management | Categories are one level |
| 3 | M | Not available | Create subfolders | 25. Bookmark Folder Management | Categories are one level |
| 3 | M | Not available | Unlimited folder nesting where practical | 25. Bookmark Folder Management | Categories are one level |
| 3 | S | Not available | Bookmark with keyboard shortcut | 26. Advanced Bookmark Features | Not built |
| 3 | S | Not available | Favorite bookmarks | 26. Advanced Bookmark Features | Not built |
| 3 | S | Not available | Pinned bookmarks | 26. Advanced Bookmark Features | Not built |
| 3 | S | Partial | Advanced bookmark filters | 26. Advanced Bookmark Features | Category filter + search; no sort options |
| 3 | S | Partial | Bookmark sorting | 26. Advanced Bookmark Features | Category filter + search; no sort options |
| 3 | M | Partial | Folder synchronization where supported | 27. Advanced Folder Experience | Settings sync via Chrome sync; history/saved links stay local |
| 3 | M | Not available | Saved playlists | 28. Media Library Organization | Not built |
| 3 | S | Not available | Automatic backup | 29. Extra Productivity Features | Not built |
| 3 | M | Partial | Cross-device synchronization where supported | 29. Extra Productivity Features | Settings sync via Chrome sync; history/saved links stay local |
| 3 | M | Not available | Download prioritization | 3. Download Management | Not built |
| 3 | M | Not available | Queue reordering | 3. Download Management | Not built |
| 3 | M | Not available | Download scheduling | 3. Download Management | Not built |
| 3 | M | Not available | Download speed limiter | 3. Download Management | Not built |
| 3 | M | Not available | Bandwidth management | 3. Download Management | Not built |
| 3 | S | Not available | Download queue statistics | 3. Download Management | Not built |
| 3 | S | Not available | Favorite Bookmarks | 30. Recommended Main Navigation | Not built |
| 3 | S | Not available | Favorites | 30. Recommended Main Navigation | Not built |
| 3 | M | Not available | Analytics | 30. Recommended Main Navigation | Not built |
| 3 | M | Partial | H.265/HEVC support | 4. Video Quality And Format | Downloaded as-is when the site offers them; no special handling |
| 3 | M | Partial | AV1 support | 4. Video Quality And Format | Downloaded as-is when the site offers them; no special handling |
| 3 | M | Partial | Metadata preservation | 4. Video Quality And Format | Container data kept; title/artist tags not written |
| 3 | S | Partial | Thumbnail extraction | 4. Video Quality And Format | Poster shown, can open/copy; not saved alongside the video |
| 3 | S | Partial | Custom notifications | 5. Smart Features | On/off only |
| 3 | M | Not available | Smart download queue optimization | 6. Advanced Download Engine | Not built |
| 3 | M | Not available | Adaptive download concurrency | 6. Advanced Download Engine | Not built |
| 3 | M | Not available | Network-aware download settings | 6. Advanced Download Engine | Not built |
| 3 | M | Not available | Download speed analytics | 6. Advanced Download Engine | Not built |
| 3 | M | Not available | Bandwidth usage monitoring | 6. Advanced Download Engine | Not built |
| 3 | M | Not available | Smart download prioritization | 6. Advanced Download Engine | Not built |
| 3 | M | Not available | Download performance monitoring | 6. Advanced Download Engine | Not built |
| 3 | M | Not available | Connection status monitoring | 6. Advanced Download Engine | Not built |
| 3 | M | Not available | Automatically download videos above 1080p | 8. Smart Download Rules | No auto-download rules |
| 3 | M | Not available | Automatically prioritize high-quality downloads | 8. Smart Download Rules | Not built |
| 3 | M | Not available | AI video title generation | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 3 | L | Not available | AI chapter detection | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 3 | M | Not available | AI filename generation | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 3 | M | Not available | AI video categorization | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 3 | L | Not available | AI timestamp generation | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 2 | S | Partial | Keyboard shortcut settings | 12. Settings Dashboard | Changed at chrome://extensions/shortcuts (Chrome); not inside VidPull |
| 2 | S | Not available | Download started notification | 15. Notifications And Automation | Not built |
| 2 | S | Not available | Download paused notification | 15. Notifications And Automation | Not built |
| 2 | S | Not available | Download resumed notification | 15. Notifications And Automation | Not built |
| 2 | M | Not available | Low disk space warning | 15. Notifications And Automation | Chrome doesn't expose free disk space to extensions |
| 2 | S | Not available | Automatic retry notification | 15. Notifications And Automation | Not built |
| 2 | S | Not available | Optional notification sounds | 15. Notifications And Automation | Not built |
| 2 | M | Partial | Custom themes | 17. Premium / Pro Features | Light/dark + 7 accent colours + custom colour; no full theme editor |
| 2 | L | Not available | AI-powered video search | 17. Premium / Pro Features | Needs an AI service (API key/cost) or a large local model |
| 2 | M | Not available | Extension health monitoring | 19. Additional Professional Features | Not built |
| 2 | L | Not available | AI video search | 21. Development Roadmap · Phase 4 – Premium | Needs an AI service (API key/cost) or a large local model |
| 2 | M | Partial | Premium themes | 21. Development Roadmap · Phase 4 – Premium | Light/dark + 7 accent colours + custom colour; no full theme editor |
| 2 | S | Not available | Torrent client integration | 22. Torrent Download Features | Hand magnet links to qBittorrent etc. (the browser already does this) |
| 2 | S | Not available | External torrent client support | 22. Torrent Download Features | Hand magnet links to qBittorrent etc. (the browser already does this) |
| 2 | S | Not available | Default torrent application selection | 22. Torrent Download Features | Hand magnet links to qBittorrent etc. (the browser already does this) |
| 2 | S | Not available | Magnet link opening preferences | 22. Torrent Download Features | Hand magnet links to qBittorrent etc. (the browser already does this) |
| 2 | S | Not available | Previous and next controls where supported | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 2 | S | Not available | Full-screen mode | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 2 | S | Not available | PIP window positioning | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 2 | S | Not available | PIP window size preferences | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 2 | S | Not available | Multiple PIP compatibility checks | 23. Picture-In-Picture (Pip) View | VidPull's own panel can float (Keep on top), but there's no video Picture-in-Picture |
| 2 | M | Not available | Create unlimited folders where storage permits | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Move folders | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Copy folders | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Duplicate folders | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Drag-and-drop folder organization | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Drag-and-drop bookmark organization | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Copy bookmarks between folders | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Multi-select bookmarks | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Multi-select folders | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Bulk move bookmarks | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Bulk delete bookmarks | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Bulk rename bookmarks | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Folder descriptions | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Folder icons | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Folder cover images | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Folder favorites | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Pin important folders | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Sort folders alphabetically | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Sort folders by date | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Custom folder ordering | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Expand and collapse folders | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Expand all folders | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Collapse all folders | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Folder search | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Search inside folders | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Folder storage information | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Recently opened folders | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Recently added bookmarks | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Recently modified folders | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Empty folder detection | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Duplicate folder detection | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | M | Not available | Empty folder cleanup | 25. Bookmark Folder Management | Saved links has flat categories only |
| 2 | S | Not available | Save webpage favicon | 26. Advanced Bookmark Features | Not in Saved links |
| 2 | S | Partial | Save webpage thumbnail | 26. Advanced Bookmark Features | Video thumbnails kept; page description no |
| 2 | S | Partial | Save page description | 26. Advanced Bookmark Features | Video thumbnails kept; page description no |
| 2 | S | Not available | Save selected text | 26. Advanced Bookmark Features | Not built |
| 2 | S | Not available | Save multiple links at once | 26. Advanced Bookmark Features | Not in Saved links |
| 2 | M | Not available | Automatic bookmark categorization | 26. Advanced Bookmark Features | Not built |
| 2 | S | Partial | Custom bookmark tags | 26. Advanced Bookmark Features | Coloured categories work like one tag per item |
| 2 | S | Partial | Bookmark color labels | 26. Advanced Bookmark Features | Coloured categories work like one tag per item |
| 2 | S | Not available | Recently visited bookmarks | 26. Advanced Bookmark Features | Not in Saved links |
| 2 | S | Not available | Recently added bookmarks | 26. Advanced Bookmark Features | Not in Saved links |
| 2 | S | Not available | Recently updated bookmarks | 26. Advanced Bookmark Features | Not in Saved links |
| 2 | S | Not available | Open all bookmarks in folder | 26. Advanced Bookmark Features | Not in Saved links |
| 2 | S | Not available | Open selected bookmarks | 26. Advanced Bookmark Features | Not in Saved links |
| 2 | S | Not available | Export bookmarks as HTML | 26. Advanced Bookmark Features | Browser-bookmark format |
| 2 | S | Not available | Import bookmarks from HTML | 26. Advanced Bookmark Features | Browser-bookmark format |
| 2 | M | Partial | Sidebar folder navigation | 27. Advanced Folder Experience | Category chips; no tree |
| 2 | M | Not available | Tree-style folder view | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Grid folder view | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Folder breadcrumb navigation | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Folder context menu | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Right-click folder actions | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Folder preview | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Partial | Folder quick access | 27. Advanced Folder Experience | Category chips; no tree |
| 2 | M | Not available | Favorite folder shortcuts | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Recent folders section | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Smart folders | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Automatic folders | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Custom folder rules | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Dynamic folders based on tags | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Dynamic folders based on website | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Dynamic folders based on date | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Dynamic folders based on content type | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Folder-level sorting | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Folder-level bulk actions | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Folder-level notes | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Folder-level metadata | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Not available | Folder-level backup | 27. Advanced Folder Experience | Saved links has flat categories only |
| 2 | M | Partial | Audio folders | 28. Media Library Organization | Audio downloads in History; no audio library |
| 2 | M | Not available | Educational content folders | 28. Media Library Organization | Not in Saved links |
| 2 | M | Not available | Entertainment folders | 28. Media Library Organization | Not in Saved links |
| 2 | M | Not available | Custom media tags | 28. Media Library Organization | Not in Saved links |
| 2 | S | Partial | Media sorting | 28. Media Library Organization | Media list sortable; saved links not |
| 2 | M | Not available | Smart media organization | 28. Media Library Organization | Not in Saved links |
| 2 | M | Not available | Custom collection covers | 28. Media Library Organization | Not in Saved links |
| 2 | M | Not available | Quick search shortcut | 29. Extra Productivity Features | Not built |
| 2 | M | Not available | Command palette | 29. Extra Productivity Features | Not built |
| 2 | M | Not available | Drag-and-drop organization | 29. Extra Productivity Features | Not built |
| 2 | M | Not available | Split-view dashboard | 29. Extra Productivity Features | Not built |
| 2 | M | Not available | Favorites dashboard | 29. Extra Productivity Features | Not built |
| 2 | M | Not available | Customizable home screen | 29. Extra Productivity Features | Not built |
| 2 | M | Not available | Custom dashboard widgets | 29. Extra Productivity Features | Not built |
| 2 | S | Partial | Activity history | 29. Extra Productivity Features | Download history only |
| 2 | M | Not available | Optional encrypted backup | 29. Extra Productivity Features | Not built |
| 2 | S | Partial | Customizable shortcuts | 29. Extra Productivity Features | Changed at chrome://extensions/shortcuts (Chrome); not inside VidPull |
| 2 | S | Partial | Recently Added | 30. Recommended Main Navigation | Saved links sorted newest first; no ‘visited’ |
| 2 | S | Partial | Recently Visited | 30. Recommended Main Navigation | Saved links sorted newest first; no ‘visited’ |
| 2 | M | Partial | Folder 1 | 30. Recommended Main Navigation | Example entries — categories exist, no subfolders |
| 2 | M | Partial | Subfolder 1 | 30. Recommended Main Navigation | Example entries — categories exist, no subfolders |
| 2 | M | Partial | Subfolder 2 | 30. Recommended Main Navigation | Example entries — categories exist, no subfolders |
| 2 | M | Partial | Folder 2 | 30. Recommended Main Navigation | Example entries — categories exist, no subfolders |
| 2 | M | Partial | Subfolder 1 | 30. Recommended Main Navigation | Example entries — categories exist, no subfolders |
| 2 | M | Partial | Folder 3 | 30. Recommended Main Navigation | Example entries — categories exist, no subfolders |
| 2 | M | Partial | Custom bitrate selection | 4. Video Quality And Format | Pick a variant (labels show bitrate for audio); no free bitrate target |
| 2 | S | Partial | Frame rate selection | 4. Video Quality And Format | Any frame rate downloads as-is; no fps filter |
| 2 | S | Partial | 24 FPS support | 4. Video Quality And Format | Any frame rate downloads as-is; no fps filter |
| 2 | S | Partial | 30 FPS support | 4. Video Quality And Format | Any frame rate downloads as-is; no fps filter |
| 2 | S | Partial | 60 FPS support | 4. Video Quality And Format | Any frame rate downloads as-is; no fps filter |
| 2 | M | Partial | MKV format where supported | 4. Video Quality And Format | Detects/downloads MKV files; output is MP4/TS/WebM, never MKV |
| 2 | M | Not available | WAV extraction | 4. Video Quality And Format | Not built |
| 2 | M | Partial | Custom themes | 5. Smart Features | Light/dark + 7 accent colours + custom colour; no full theme editor |
| 2 | M | Not available | AI language detection | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 2 | L | Not available | AI duplicate video detection | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 2 | L | Not available | AI-powered video search | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 2 | M | Not available | AI tag generation | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 2 | M | Not available | AI keyword extraction | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 2 | M | Not available | AI content classification | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 2 | M | Not available | AI video description generation | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 2 | M | Not available | AI metadata enhancement | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 2 | L | Not available | AI library organization | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 2 | L | Not available | Natural language video search | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
| 1 | S | Not available | Notification history | 15. Notifications And Automation | Not built |
| 1 | – | Not available | Priority customer support | 17. Premium / Pro Features | Business service, not a feature |
| 1 | M | Not available | Video comparison tool | 18. Unique Differentiating Features | Not built |
| 1 | L | Not available | React frontend | 20. Technical Architecture | Plain JavaScript modules, no build step (by design) |
| 1 | L | Not available | TypeScript | 20. Technical Architecture | Plain JavaScript modules, no build step (by design) |
| 1 | L | Not available | Tailwind CSS | 20. Technical Architecture | Plain JavaScript modules, no build step (by design) |
| 1 | L | Not available | shadcn/ui components | 20. Technical Architecture | Plain JavaScript modules, no build step (by design) |
| 1 | L | Not available | Zustand state management | 20. Technical Architecture | Plain JavaScript modules, no build step (by design) |
| 1 | M | Not available | IndexedDB | 20. Technical Architecture | chrome.storage + OPFS used instead |
| 1 | L | Not available | Torrent file download support | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent metadata detection | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent name detection | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent file size display | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent file information | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent download status | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent download progress | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Download speed display | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Upload speed display | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Download pause and resume | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent download queue | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Multiple torrent management | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent download history | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent file organization | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent category management | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent completion notifications | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent download statistics | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent privacy settings | 22. Torrent Download Features | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | M | Not available | Save torrent links | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Save magnet links | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Save torrent files | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Bookmark torrent websites | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Bookmark torrent pages | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Save torrent metadata | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Save torrent titles | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Save torrent descriptions | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Save torrent thumbnails | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Save torrent file sizes | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Save torrent category | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Save source website | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Save original page URL | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Save date added | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Add personal notes | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Add custom tags | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Add favorites | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Search saved torrents | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Filter saved torrents | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Sort saved torrents | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Edit saved torrent information | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Delete saved torrents | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Bulk delete | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Bulk organize | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Export torrent bookmarks | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Import torrent bookmarks | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Copy saved magnet links | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Open original torrent page | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Check saved link availability where permitted | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Duplicate bookmark detection | 24. Torrent Saver / Torrent Bookmark Manager | Torrent bookmarking: out of scope |
| 1 | M | Not available | Torrent folders | 28. Media Library Organization | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | M | Not available | Recently watched videos | 28. Media Library Organization | Would need watch tracking (privacy) |
| 1 | S | Partial | Home | 30. Recommended Main Navigation | Media tab is the start screen |
| 1 | L | Not available | Torrent Manager | 30. Recommended Main Navigation | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Torrent Bookmarks | 30. Recommended Main Navigation | Out of VidPull's scope (needs a BitTorrent engine or an external client) |
| 1 | L | Not available | Audio normalization | 4. Video Quality And Format | Not built |
| 1 | L | Not available | AI thumbnail analysis | 9. Ai-Powered Features | Needs an AI service (API key/cost) or a large local model |
