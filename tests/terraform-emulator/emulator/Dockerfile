FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal@sha256:158a9044f9dc0777f098b76c8b54346f6ed4560b9a6a416dec7a5ba3bc483af4
COPY aws-emulator.rpm /tmp/aws-emulator.rpm
RUN rpm -i /tmp/aws-emulator.rpm && rm /tmp/aws-emulator.rpm \
    && mkdir -p /home/emulator/.aws/emulator && chown -R 1000 /home/emulator && aws-emulator -v
USER 1000
ENV HOME=/home/emulator EMULATOR_TELEMETRY=off
ENTRYPOINT ["aws-emulator", "-b", "127.0.0.1", "--telemetry", "off"]
