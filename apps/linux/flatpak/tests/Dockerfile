FROM fedora:45@sha256:a7d72ba2745b100a3351087472e5ee7b2450af7cf331e7673007e3817612839c

RUN dnf install -y --setopt=install_weak_deps=False \
      flatpak \
      sway \
      xdg-desktop-portal \
      xdg-desktop-portal-gtk \
      dbus-daemon \
      dbus-tools \
      grim \
      jq \
      ImageMagick \
      glib2 \
      gsettings-desktop-schemas \
      dconf \
      wtype \
      fuse3 \
      procps-ng \
      adwaita-sans-fonts \
      util-linux \
    && dnf clean all

RUN useradd --uid 1000 --create-home tester
