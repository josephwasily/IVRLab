FROM alpine:3.20
COPY . /prompts
RUN rm -f /prompts/Dockerfile
VOLUME /prompts
CMD ["sh", "-c", "cp -a /prompts/. /out/ && echo '[prompts-init] Done copying prompts' && exit 0"]
