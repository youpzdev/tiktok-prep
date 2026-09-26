import importlib.machinery
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


def load_plugin():
    base = types.ModuleType("base_plugin")
    base.BasePlugin = type("BasePlugin", (), {})
    base.MethodHook = type("MethodHook", (), {})
    hooks = types.ModuleType("hook_utils")
    hooks.find_class = lambda name: None
    settings = types.ModuleType("ui.settings")
    settings.Text = lambda **kwargs: kwargs
    modules = {"base_plugin": base, "hook_utils": hooks, "ui.settings": settings}
    path = Path(__file__).parents[1] / "project/exteragram/story_passthrough.plugin"
    loader = importlib.machinery.SourceFileLoader("story_passthrough", str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        loader.exec_module(module)
    return module


class StoryPassthroughTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plugin = load_plugin()

    def setUp(self):
        self.info = types.SimpleNamespace(
            isStory=True, isPhoto=False, roundVideo=False, isSticker=False,
            muted=False, volume=1.0, videoOffset=0, rotationValue=0,
            originalWidth=720, originalHeight=1280, resultWidth=720,
            resultHeight=1280, startTime=0, endTime=34530000,
            originalDuration=34530000, avatarStartTime=-1, fromCamera=False,
            wallpaperPeerId=-9223372036854775808,
            originalPath="/storage/storycopy_720p60.mp4", mixedSoundInfos=[],
            mediaEntities=[], collageParts=[], collage=None, hdrInfo=None,
            cropState=None, filterState=None, paintPath=None, blurPath=None,
            messagePath=None, messageVideoMaskPath=None, backgroundPath=None,
        )
        self.params = dict(
            isStory=True, isPhoto=False, isRound=False, isSticker=False,
            isSecret=True, muted=False, volume=1.0, videoOffset=0,
            rotationValue=0, originalWidth=720, originalHeight=1280,
            resultWidth=720, resultHeight=1280, startTime=0, endTime=34530000,
            avatarStartTime=-1, videoPath=self.info.originalPath, needCompress=True,
            bitrate=3000000, soundInfos=[],
        )
        self.media = dict(width=720, height=1280, rotation=0, fps=60,
                          duration_us=34530000, audio_duration_us=34533000,
                          size=26000000, video_mime="video/avc",
                          audio_mime="audio/mp4a-latm", audio_profile=2,
                          tracks=2, hdr=False)

    def reason(self):
        return self.plugin.rejection(self.info, self.params, self.media)

    def java_fields(self):
        fields = {}
        for name, value in self.params.items():
            kind = ("boolean" if isinstance(value, bool) else
                    "long" if name in ("startTime", "endTime", "avatarStartTime",
                                       "videoOffset") else
                    "int" if isinstance(value, int) else
                    "float" if isinstance(value, float) else "object")
            getter = lambda obj, key=name: getattr(obj, key)
            setter = lambda obj, value, key=name: setattr(obj, key, value)
            fields[name] = types.SimpleNamespace(
                getType=lambda kind=kind: types.SimpleNamespace(getName=lambda: kind),
                setAccessible=lambda value: None, get=getter, getBoolean=getter,
                getLong=getter, getInt=getter, getFloat=getter,
                setBoolean=setter, setLong=setter,
            )
        return fields

    def test_accepts_prepared_60_and_30_fps(self):
        self.assertIsNone(self.reason())
        self.media["fps"] = 30
        self.assertIsNone(self.reason())

    def test_rejects_scope_and_edits(self):
        changes = dict(isStory=False, muted=True, volume=0.7, isPhoto=True,
                       isSticker=True, roundVideo=True, fromCamera=True,
                       videoOffset=12, rotationValue=90, resultWidth=1080,
                       startTime=1000, endTime=30000000, paintPath="paint.png",
                       filterState=object(),
                       hdrInfo=types.SimpleNamespace(getHDRType=lambda: 1),
                       collage=object(), wallpaperPeerId=123,
                       mediaEntities=[object()], mixedSoundInfos=[object()])
        for key, value in changes.items():
            with self.subTest(key=key):
                old = getattr(self.info, key)
                setattr(self.info, key, value)
                self.assertIsNotNone(self.reason())
                setattr(self.info, key, old)

    def test_rejects_changed_params(self):
        for key, value in dict(resultHeight=1920, bitrate=-1,
                               volume=0.5, videoPath="/storage/other.mp4").items():
            with self.subTest(key=key):
                old = self.params[key]
                self.params[key] = value
                self.assertIsNotNone(self.reason())
                self.params[key] = old

    def test_rejects_media_outside_limits(self):
        changes = dict(width=1080, rotation=90, fps=120, size=30000001,
                       duration_us=60000001, audio_duration_us=30000000,
                       video_mime="video/hevc", audio_mime="audio/opus",
                       tracks=3, hdr=True, audio_profile=5)
        for key, value in changes.items():
            with self.subTest(key=key):
                old = self.media[key]
                self.media[key] = value
                self.assertIsNotNone(self.reason())
                self.media[key] = old

    def test_rejects_unknown_field(self):
        del self.info.blurPath
        with self.assertRaises(AttributeError):
            self.reason()

    def test_only_identity_crop_allowed(self):
        self.info.cropState = types.SimpleNamespace(
            isEmpty=lambda: True, cropPx=0.0, cropPy=0.0, orientation=0)
        self.assertIsNone(self.reason())
        self.info.cropState.cropPx = 0.01
        self.assertIsNotNone(self.reason())
        self.info.cropState.cropPx = 0
        self.info.cropState.isEmpty = lambda: False
        self.assertIsNotNone(self.reason())

    def test_reflection_reads_primitive_false_without_boxing(self):
        field = types.SimpleNamespace(
            getType=lambda: types.SimpleNamespace(getName=lambda: "boolean"),
            getBoolean=lambda obj: False,
            get=lambda obj: object(),
        )
        self.assertIs(self.plugin.read_field(field, object()), False)

    def test_aac_profile_fallback_uses_audio_specific_config(self):
        config = types.SimpleNamespace(limit=lambda: 2, get=lambda index: 0x11)
        format_ = types.SimpleNamespace(
            containsKey=lambda name: name == "csd-0",
            getByteBuffer=lambda name: config)
        self.assertEqual(self.plugin.aac_profile(format_), 2)
        config.get = lambda index: 0x29
        self.assertEqual(self.plugin.aac_profile(format_), 5)
        format_.containsKey = lambda name: False
        with self.assertRaises(ValueError):
            self.plugin.aac_profile(format_)

    def test_sample_timing_supports_60_fps_rounding_and_rejects_reordering(self):
        stamps = iter([0, 16667, 33333, 50000, -1])
        extractor = types.SimpleNamespace(
            selectTrack=lambda index: None, getSampleTime=lambda: next(stamps),
            advance=lambda: True)
        self.assertAlmostEqual(self.plugin.sample_fps(extractor, 0), 60, delta=0.01)
        stamps = iter([0, 33333, 16667, -1])
        with self.assertRaises(ValueError):
            self.plugin.sample_fps(extractor, 0)

    def test_hook_falls_back_without_mutation_when_fields_missing(self):
        del self.info.blurPath
        target = types.SimpleNamespace(**self.params)
        fields = {}
        for name in self.params:
            fields[name] = types.SimpleNamespace(
                getType=lambda: types.SimpleNamespace(getName=lambda: "object"),
                get=lambda obj, key=name: getattr(obj, key))
        messages = []
        plugin = types.SimpleNamespace(active=True, fields=fields, report=messages.append)
        param = types.SimpleNamespace(
            args=[None] * 18 + [self.info], hasThrowable=lambda: False,
            getResult=lambda: target)
        with patch.object(self.plugin, "inspect_media", return_value=self.media):
            self.plugin.ConversionHook(plugin).after_hooked_method(param)
        self.assertEqual(vars(target), self.params)
        self.assertIn("Skipped:", messages[-1])

    def test_non_story_never_inspects_file(self):
        self.info.isStory = False
        plugin = types.SimpleNamespace(active=True)
        param = types.SimpleNamespace(
            args=[None] * 18 + [self.info], hasThrowable=lambda: False)
        with patch.object(self.plugin, "inspect_media") as inspect:
            self.plugin.ConversionHook(plugin).after_hooked_method(param)
        inspect.assert_not_called()

    def test_successful_hook_and_unload(self):
        fields = self.java_fields()
        method = types.SimpleNamespace(
            getName=lambda: "of", setAccessible=lambda value: None,
            getParameterTypes=lambda: [types.SimpleNamespace(getName=lambda n=n: n)
                                       for n in self.plugin.SIGNATURE])
        clazz = types.SimpleNamespace(getDeclaredMethods=lambda: [method],
                                      getDeclaredField=lambda name: fields[name])
        plugin = self.plugin.StoryCopyPlugin()
        events = []
        plugin.log = events.append
        installed = []
        removed = []
        token = object()
        plugin.hook_method = lambda method, hook: installed.append(hook) or token
        plugin.unhook_method = removed.append
        with patch.object(self.plugin, "find_class", return_value=clazz):
            plugin.on_plugin_load()
        self.assertTrue(plugin.active)
        self.assertEqual(len(installed), 1)
        self.assertTrue(plugin.status.startswith("Ready:"))
        target = types.SimpleNamespace(**self.params)
        param = types.SimpleNamespace(
            args=[None] * 18 + [self.info], hasThrowable=lambda: False,
            getResult=lambda: target)
        with patch.object(self.plugin, "inspect_media", return_value=self.media):
            installed[0].after_hooked_method(param)
        self.assertFalse(target.needCompress)
        self.assertEqual(target.endTime, -1)
        self.assertEqual(self.info.endTime, 34530000)
        self.assertTrue(plugin.status.startswith("Copy requested:"))
        plugin.on_plugin_unload()
        self.assertFalse(plugin.active)
        self.assertEqual(removed, [token])
        installed[0].after_hooked_method(None)

    def test_incompatible_app_does_not_register_hook(self):
        method = types.SimpleNamespace(
            getName=lambda: "of", getParameterTypes=lambda: [])
        for methods in ([], [method]):
            plugin = self.plugin.StoryCopyPlugin()
            plugin.log = lambda message: None
            registered = []
            plugin.hook_method = lambda *args: registered.append(args)
            clazz = types.SimpleNamespace(getDeclaredMethods=lambda: methods)
            with patch.object(self.plugin, "find_class", return_value=clazz):
                plugin.on_plugin_load()
            self.assertFalse(plugin.active)
            self.assertFalse(registered)
            self.assertTrue(plugin.status.startswith("Unavailable:"))
        with patch.object(self.plugin, "find_class", return_value=None):
            plugin.on_plugin_load()
        self.assertFalse(plugin.active)
        self.assertFalse(registered)

    def test_missing_required_field_does_not_register_hook(self):
        method = types.SimpleNamespace(
            getName=lambda: "of",
            getParameterTypes=lambda: [types.SimpleNamespace(getName=lambda n=n: n)
                                       for n in self.plugin.SIGNATURE])
        fields = self.java_fields()
        del fields["endTime"]
        clazz = types.SimpleNamespace(getDeclaredMethods=lambda: [method],
                                      getDeclaredField=lambda name: fields[name])
        plugin = self.plugin.StoryCopyPlugin()
        plugin.log = lambda message: None
        registered = []
        plugin.hook_method = lambda *args: registered.append(args)
        with patch.object(self.plugin, "find_class", return_value=clazz):
            plugin.on_plugin_load()
        self.assertFalse(plugin.active)
        self.assertFalse(registered)

    def test_media_resources_released_when_open_fails(self):
        released = []

        def fail(path):
            raise RuntimeError("unreadable media")

        extractor = types.SimpleNamespace(
            setDataSource=fail, release=lambda: released.append("extractor"))
        retriever = types.SimpleNamespace(release=lambda: released.append("retriever"))
        media_module = types.ModuleType("android.media")
        media_module.MediaExtractor = lambda: extractor
        media_module.MediaMetadataRetriever = lambda: retriever
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "storycopy_test.mp4"
            path.write_bytes(b"\x00\x00\x00\x18ftypisom")
            with patch.dict(sys.modules, {"android.media": media_module}):
                with self.assertRaises(RuntimeError):
                    self.plugin.inspect_media(str(path))
        self.assertEqual(released, ["extractor", "retriever"])

    def test_only_compression_flag_changes(self):
        target = types.SimpleNamespace(**self.params)
        before = dict(vars(target))
        field = types.SimpleNamespace(
            getBoolean=lambda obj: obj.needCompress,
            setBoolean=lambda obj, value: setattr(obj, "needCompress", value))
        self.plugin.disable_compression(target, field)
        before["needCompress"] = False
        self.assertEqual(vars(target), before)

    def test_failed_mutation_rolls_back(self):
        target = types.SimpleNamespace(needCompress=True)

        def setter(obj, value):
            obj.needCompress = value
            if not value:
                raise RuntimeError("bridge failure")

        field = types.SimpleNamespace(getBoolean=lambda obj: obj.needCompress,
                                      setBoolean=setter)
        with self.assertRaises(RuntimeError):
            self.plugin.disable_compression(target, field)
        self.assertTrue(target.needCompress)

    def test_remux_reads_to_eof_and_preserves_dimensions(self):
        target = types.SimpleNamespace(**self.params)
        before = dict(vars(target))
        fields = dict(
            needCompress=types.SimpleNamespace(
                getBoolean=lambda obj: obj.needCompress,
                setBoolean=lambda obj, value: setattr(obj, "needCompress", value)),
            endTime=types.SimpleNamespace(
                getLong=lambda obj: obj.endTime,
                setLong=lambda obj, value: setattr(obj, "endTime", value)),
        )
        self.plugin.request_copy(target, fields)
        before.update(needCompress=False, endTime=-1)
        self.assertEqual(vars(target), before)

    def test_remux_rolls_back_both_fields(self):
        target = types.SimpleNamespace(**self.params)
        before = dict(vars(target))

        def setter(obj, value):
            obj.needCompress = value
            if not value:
                raise RuntimeError("bridge failure")

        fields = dict(
            needCompress=types.SimpleNamespace(
                getBoolean=lambda obj: obj.needCompress, setBoolean=setter),
            endTime=types.SimpleNamespace(
                getLong=lambda obj: obj.endTime,
                setLong=lambda obj, value: setattr(obj, "endTime", value)),
        )
        with self.assertRaises(RuntimeError):
            self.plugin.request_copy(target, fields)
        self.assertEqual(vars(target), before)


if __name__ == "__main__":
    unittest.main()
