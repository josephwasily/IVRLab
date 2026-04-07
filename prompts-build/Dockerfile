FROM alpine:3.20
COPY . /data/
RUN rm -f /data/Dockerfile
CMD ["sh", "-c", "cp -a /data/. /out/ && echo '[prompts-init] All audio files copied' && exit 0"]
