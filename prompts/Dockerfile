FROM alpine:3.20
COPY . /prompts
RUN rm -f /prompts/Dockerfile
CMD ["sh", "-c", "cp -a /prompts/. /out/ && echo '[prompts-init] Done' && exit 0"]
