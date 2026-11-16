FROM eclipse-temurin:21-jdk@sha256:0a3f329821dcadf54b2a3033a15e2e9f007069a9db43d7f51897e6b80e726b07

ARG CMDLINE_TOOLS_URL=https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip
ARG CMDLINE_TOOLS_SHA256=0877a1d048fe4a24efe2eff536ca4223f7adeb58648bb81909d33c446918cfa8
ARG ANDROID_PLATFORM=platforms;android-37.0
ARG ANDROID_BUILD_TOOLS=build-tools;37.0.0
ARG ANDROID_NDK=ndk;30.0.16248370

ENV ANDROID_HOME=/opt/android-sdk \
    GRADLE_USER_HOME=/gradle \
    GRADLE_OPTS=-Dorg.gradle.daemon=false
ENV PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH

RUN curl -fsSL -o /tmp/cmdline-tools.zip "$CMDLINE_TOOLS_URL" \
    && echo "$CMDLINE_TOOLS_SHA256  /tmp/cmdline-tools.zip" | sha256sum -c - \
    && mkdir -p "$ANDROID_HOME/cmdline-tools" /tmp/cmdline-tools \
    && (cd /tmp/cmdline-tools && jar xf /tmp/cmdline-tools.zip) \
    && chmod +x /tmp/cmdline-tools/cmdline-tools/bin/* \
    && mv /tmp/cmdline-tools/cmdline-tools "$ANDROID_HOME/cmdline-tools/latest" \
    && rm -rf /tmp/cmdline-tools /tmp/cmdline-tools.zip

RUN yes | sdkmanager --licenses > /dev/null \
    && sdkmanager platform-tools "$ANDROID_PLATFORM" "$ANDROID_BUILD_TOOLS" "$ANDROID_NDK"

WORKDIR /src/apps/android
