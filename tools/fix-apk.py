import sys
import time
import zipfile


def main() -> None:
    src, dst, dex = sys.argv[1], sys.argv[2], sys.argv[3]
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
        for info in zin.infolist():
            data = zin.read(info)
            name = info.filename.replace("\\", "/")
            stored = name in ("resources.arsc", "AndroidManifest.xml")
            entry = zipfile.ZipInfo(name, info.date_time)
            entry.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
            entry.external_attr = info.external_attr
            zout.writestr(entry, data)
        with open(dex, "rb") as handle:
            entry = zipfile.ZipInfo("classes.dex", time.localtime()[:6])
            entry.compress_type = zipfile.ZIP_DEFLATED
            zout.writestr(entry, handle.read())


if __name__ == "__main__":
    main()
