# Multi-stage: build or fetch static ffmpeg, then copy into Lambda base
FROM public.ecr.aws/lambda/nodejs:20 AS base

# Copy prebuilt static ffmpeg/ffprobe (or build in a preceding stage)
# Example uses a pinned tarball; verify SHA256 in build.sh
WORKDIR /opt/bin
# Place ffmpeg and ffprobe here during build.sh

FROM public.ecr.aws/lambda/nodejs:20
# Copy ffmpeg/ffprobe into PATH
COPY --from=base /opt/bin/ffmpeg /opt/bin/ffmpeg
COPY --from=base /opt/bin/ffprobe /opt/bin/ffprobe
ENV PATH="/opt/bin:${PATH}"
# Optionally, copy node_modules if needed, otherwise functions bring their own
CMD ["index.handler"]
