# Extensions

Browser extensions. Each extension is its own repository, linked here as a sub-repo (git submodule).

| Sub-repo | Extension | Latest |
|---|---|---|
| [`video-downloader-extension`](https://github.com/vinayi220997/video-downloader-extension) | **VidPull – Video Downloader** (Chrome MV3; called VidSnag before 3.0). Source, full history, docs, tests, and an install zip for every version in `releases/` | 3.1.1 |

## Clone everything

```bash
git clone --recurse-submodules https://github.com/vinayi220997/Extensions
```

Already cloned without the sub-repos? Run `git submodule update --init`.

## Get the newest version of a sub-repo

```bash
git submodule update --remote video-downloader-extension
git commit -am "Update video-downloader-extension"
```
