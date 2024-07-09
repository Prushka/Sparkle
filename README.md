# Discord / Website Watch Party

A fully synced web-based watch party that supports (both on desktop & mobile):
1. Chat, Profile Picture, Pause, Play, Seek, Media Switch real-time sync base on room
2. HDR with `AV1`, `HEVC`, `H.264` codec switching (if browser supports)
3. All main stream subtitles & language selection (note: iOS only supports WebVTT in fullscreen):
   - `SSA/ASS`
   - `WebVTT`
   - `SUP` (the image subtitle format)
   - `SRT` 
4. Thumbnail (Video Storyboard/Preview) | Poster (Video Cover)
5. HTML embed headers with dominant color based on show/episode
6. Multiple audio selection
7. Media selection with season and episode support
8. Auto Reconnect
9. In background (tabbed out) notifications


![Main Page](readme/main.png)

# Discord Activity Support

Discord recently introduced public developer preview activities. 
This site can be added into your custom discord activity in developer portal.
Doing so will use discord OAuth2 for username and profile picture syncing.
Channel id will be used as the room id. All functionalities mentioned above are supported in discord activity.

![Discord App](readme/app.png)

### Discord Status
![Discord App](readme/status.png)

### Discord Embed

<img src="readme/embed.png" width="300">


# This repository contains only the frontend & SSR part

The backend part is still a work-in-progress.

Currently, this project is intended to be used as an extension to
[Sonarr](https://github.com/Sonarr/Sonarr)/[Radarr](https://github.com/Radarr/Radarr) and your local media library.

It needs to be self-hosted like certain media players (_e.g.,_ Plex).

Video files are first processed and transcoded by the backend to:
1. Encode the video files to `AV1`, `HEVC`, `H.264` codecs
2. Generate thumbnails (video storyboards for preview) and posters
3. Extract subtitles and audio tracks
4. Generate the necessary metadata for the frontend (nfo files, dominant theme color, chapter timestamps & titles, etc.)
