import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:video_player/video_player.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../data/models.dart';
import '../data/repo.dart';
import 'widgets.dart';

class _M {
  final String kind, ext, mime; final Uint8List bytes; final int w, h, d;
  _M(this.kind, this.ext, this.mime, this.bytes, {this.w = 0, this.h = 0, this.d = 0});
}

class ComposePage extends StatefulWidget {
  final Post? edit;
  const ComposePage({super.key, this.edit});
  @override
  State<ComposePage> createState() => _ComposeState();
}

class _ComposeState extends State<ComposePage> {
  final _t = TextEditingController(); final _picker = ImagePicker(); final List<_M> _media = [];
  String _vis = 'public'; bool _random = false, _busy = false, _rec = false; String _status = ''; int _recMs = 0; Timer? _recT; AudioRecorder? _recorder;
  bool get _editing => widget.edit != null;

  @override
  void initState() {
    super.initState();
    final e = widget.edit;
    if (e != null) { _t.text = e.body; _vis = e.visibility; _random = e.inRandom; }
    else { Repo.i.mySettings().then((s) { if (mounted) setState(() => _vis = '${s['default_visibility'] ?? 'public'}'); }).catchError((_) {}); }
  }
  @override
  void dispose() { _recT?.cancel(); _recorder?.dispose(); _t.dispose(); super.dispose(); }

  bool _room() { if (_media.length >= 4) { toast(context, tr('compose.max4')); return false; } return true; }

  Future<bool> _addImage(XFile x) async {
    final name = x.name.toLowerCase();
    final ext = name.endsWith('.png') ? 'png' : name.endsWith('.webp') ? 'webp' : 'jpg';
    final bytes = await x.readAsBytes();
    int w = 0, h = 0;
    try { final img = await decodeImageFromList(bytes); w = img.width; h = img.height; img.dispose(); } catch (_) {}
    if (!mounted) return false;
    setState(() => _media.add(_M('photo', ext, ext == 'jpg' ? 'image/jpeg' : 'image/$ext', bytes, w: w, h: h)));
    return true;
  }
  // maxWidth saja (tanpa maxHeight) → foto PANJANG tidak ikut mengecil; resolusi lain mengikuti kamera perangkat.
  Future<bool> _shootOne(bool front) async {
    if (!_room()) return false;
    final x = await _picker.pickImage(source: ImageSource.camera, preferredCameraDevice: front ? CameraDevice.front : CameraDevice.rear, maxWidth: 1280, imageQuality: 78);
    if (x == null) return false;
    return _addImage(x);
  }
  Future<void> _camera() async {
    final m = await showModalBottomSheet<String>(context: context, builder: (c) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      ListTile(leading: const Icon(Icons.camera_rear_outlined), title: Text(tr('compose.back')), onTap: () => Navigator.pop(c, 'back')),
      ListTile(leading: const Icon(Icons.camera_front_outlined), title: Text(tr('compose.front')), onTap: () => Navigator.pop(c, 'front')),
      ListTile(leading: const Icon(Icons.flip_camera_android_outlined), title: Text(tr('compose.both')), subtitle: Text(tr('compose.bothHint')), onTap: () => Navigator.pop(c, 'both')),
    ])));
    if (m == null) return;
    if (m == 'back' || m == 'both') { if (!await _shootOne(false)) return; }
    if (m == 'front' || m == 'both') { await _shootOne(true); }
  }
  Future<void> _gallery() async {
    if (!_room()) return;
    final xs = await _picker.pickMultiImage(maxWidth: 1280, imageQuality: 78, limit: 4 - _media.length);
    for (final x in xs.take(4 - _media.length)) { await _addImage(x); }
  }
  Future<void> _video(ImageSource src) async {
    if (!_room()) return;
    final x = await _picker.pickVideo(source: src, maxDuration: const Duration(seconds: 10));
    if (x == null) return;
    if (!x.name.toLowerCase().endsWith('.mp4')) { toast(context, 'MP4'); return; }
    final bytes = await x.readAsBytes();
    if (bytes.length > 50 * 1024 * 1024) { toast(context, '≤ 50 MB'); return; }
    int d = 0, w = 0, h = 0;
    try {
      final c = VideoPlayerController.networkUrl(kIsWeb ? Uri.parse(x.path) : Uri.file(x.path));
      await c.initialize(); d = c.value.duration.inMilliseconds; w = c.value.size.width.round(); h = c.value.size.height.round(); await c.dispose();
    } catch (_) {}
    if (d > 10500) { toast(context, tr('compose.video10')); return; }
    if (mounted) setState(() => _media.add(_M('video', 'mp4', 'video/mp4', bytes, w: w, h: h, d: d)));
  }
  Future<void> _toggleRec() async {
    if (_rec) {
      _recT?.cancel();
      final path = await _recorder!.stop(); final ms = _recMs;
      setState(() => _rec = false);
      if (path == null || ms < 500) return;
      final bytes = await XFile(path).readAsBytes();
      if (!mounted) return;
      setState(() => _media.add(kIsWeb ? _M('audio', 'webm', 'audio/webm', bytes, d: ms) : _M('audio', 'm4a', 'audio/mp4', bytes, d: ms)));
      return;
    }
    if (!_room()) return;
    _recorder ??= AudioRecorder();
    if (!await _recorder!.hasPermission()) { if (mounted) toast(context, tr('error')); return; }
    String path = '';
    if (!kIsWeb) path = '${(await getTemporaryDirectory()).path}/rec_${uuidV4()}.m4a';
    await _recorder!.start(RecordConfig(encoder: kIsWeb ? AudioEncoder.opus : AudioEncoder.aacLc, bitRate: 64000, numChannels: 1, sampleRate: 44100), path: path);
    _recMs = 0;
    _recT = Timer.periodic(const Duration(milliseconds: 250), (_) { _recMs += 250; if (_recMs >= 600000) { _toggleRec(); } else if (mounted) setState(() {}); });
    setState(() => _rec = true);
  }

  Future<void> _send() async {
    final text = _t.text.trim();
    if (_editing) {
      setState(() => _busy = true);
      try { await Repo.i.editPost(widget.edit!.id, body: text, visibility: _vis, inRandom: _random && _vis == 'public'); final p = await Repo.i.post(widget.edit!.id); if (mounted) context.pop(p); }
      catch (e) { if (mounted) { toast(context, errText(e, tr)); setState(() => _busy = false); } }
      return;
    }
    if (text.isEmpty && _media.isEmpty) { toast(context, tr('compose.empty')); return; }
    setState(() { _busy = true; _status = tr('compose.uploading'); });
    final up = <MediaItem>[];
    try {
      for (var i = 0; i < _media.length; i++) {
        final m = _media[i]; setState(() => _status = '${tr('compose.uploading')} ${i + 1}/${_media.length}');
        up.add(m.kind == 'photo' ? await Repo.i.uploadPhoto(m.bytes, w: m.w, h: m.h) : await Repo.i.uploadFile(m.bytes, m.ext, m.kind, w: m.w, h: m.h, d: m.d));
      }
      await Repo.i.createPost(body: text, media: up, visibility: _vis, inRandom: _random && _vis == 'public' && up.isNotEmpty);
      if (mounted) context.pop(true);
    } catch (e) {
      if (mounted) { toast(context, errText(e, tr)); setState(() { _busy = false; _status = ''; }); }
    }
  }

  Future<void> _options() async {
    await showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (c) => StatefulBuilder(builder: (c, set) => SafeArea(child: ConstrainedBox(constraints: BoxConstraints(maxHeight: MediaQuery.of(c).size.height * .8), child: ListView(shrinkWrap: true, children: [
      Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 6), child: Text(tr('compose.visibility'), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
      for (final v in kVisibilities) ListTile(dense: true, title: Text(tr('vis.$v')), trailing: _vis == v ? const Icon(Icons.check) : null, onTap: () { setState(() => _vis = v); set(() {}); }),
      if ((_media.isNotEmpty || (widget.edit?.media.isNotEmpty ?? false)) && _vis == 'public') SwitchListTile(title: Text(tr('compose.random')), value: _random, onChanged: (v) { setState(() => _random = v); set(() {}); }),
    ])))));
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme; final mute = cs.onSurface.withValues(alpha: .45); final off = _busy || _rec;
    final canPost = !_busy && !_rec && (_t.text.trim().isNotEmpty || _media.isNotEmpty || _editing);
    Widget tool(IconData i, String tip, VoidCallback? f) => IconButton(tooltip: tip, onPressed: off ? null : f, icon: Icon(i, size: 26, color: off ? mute.withValues(alpha: .3) : mute));
    return PopScope(canPop: !_busy, child: Scaffold(
      appBar: AppBar(leading: IconButton(icon: const Icon(Icons.close, size: 26), onPressed: _busy ? null : () => context.pop()), title: Text(_editing ? tr('compose.edit') : tr('compose.new'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18))),
      body: Column(children: [
        const Divider(height: 1),
        Expanded(child: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 24), keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Avatar(keyPath: null, name: Repo.i.me?.displayName ?? '?', size: 40), const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(Repo.i.me?.username ?? '', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15.5)),
              TextField(controller: _t, minLines: 1, maxLines: 14, maxLength: 2000, autofocus: !_editing, onChanged: (_) => setState(() {}), style: const TextStyle(fontSize: 16, height: 1.35),
                buildCounter: (_, {required currentLength, required isFocused, maxLength}) => null,
                decoration: InputDecoration(hintText: tr('compose.hint'), filled: false, border: InputBorder.none, enabledBorder: InputBorder.none, focusedBorder: InputBorder.none, isDense: true, contentPadding: const EdgeInsets.symmetric(vertical: 6))),
              if (!_editing) Row(children: [
                tool(Icons.photo_library_outlined, tr('compose.gallery'), _gallery), tool(Icons.photo_camera_outlined, tr('compose.photo'), _camera),
                tool(Icons.videocam_outlined, tr('compose.video'), () => _video(ImageSource.camera)), tool(Icons.video_library_outlined, tr('compose.video'), () => _video(ImageSource.gallery)),
                IconButton(tooltip: tr('compose.audio'), onPressed: _busy ? null : _toggleRec, icon: Icon(_rec ? Icons.stop_circle : Icons.mic_none, size: 26, color: _rec ? OC.like : mute)),
              ]),
              if (_rec) Padding(padding: const EdgeInsets.only(top: 4, bottom: 8), child: Row(children: [const Icon(Icons.fiber_manual_record, color: OC.like, size: 14), const SizedBox(width: 8), Text('${tr('compose.recording')} ${fmtDur(_recMs)}', style: TextStyle(color: mute))])),
              if (_media.isNotEmpty) SizedBox(height: 132, child: ListView.separated(scrollDirection: Axis.horizontal, itemCount: _media.length, separatorBuilder: (_, __) => const SizedBox(width: 8), itemBuilder: (c, i) => _thumb(i, cs))),
              if (_status.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_status, style: TextStyle(color: mute))),
            ])),
          ]),
        ])),
        const Divider(height: 1),
        SafeArea(top: false, child: Padding(padding: const EdgeInsets.fromLTRB(8, 6, 14, 8), child: Row(children: [
          TextButton.icon(onPressed: _busy ? null : _options, icon: Icon(Icons.tune, size: 22, color: mute), label: Text(tr('compose.options'), style: TextStyle(color: mute, fontWeight: FontWeight.w500))),
          Text(' · ${tr('vis.$_vis')}', style: TextStyle(color: mute.withValues(alpha: .8), fontSize: 13)),
          const Spacer(),
          FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 22), shape: const StadiumBorder()), onPressed: canPost ? _send : null,
            child: _busy ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: cs.surface)) : Text(tr('compose.send'))),
        ]))),
      ]),
    ));
  }

  Widget _thumb(int i, ColorScheme cs) {
    final m = _media[i];
    final child = m.kind == 'photo' ? Image.memory(m.bytes, fit: BoxFit.cover)
      : Container(color: m.kind == 'video' ? const Color(0xFF161616) : cs.surfaceContainerHighest, child: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(m.kind == 'video' ? Icons.play_arrow_rounded : Icons.mic, size: 30, color: m.kind == 'video' ? Colors.white : cs.onSurface), Text(fmtDur(m.d), style: TextStyle(fontSize: 11, color: m.kind == 'video' ? Colors.white70 : cs.onSurface))])));
    return Stack(children: [
      Container(width: 100, height: 132, clipBehavior: Clip.antiAlias, decoration: BoxDecoration(color: cs.surfaceContainerHighest, borderRadius: BorderRadius.circular(14)), child: child),
      Positioned(right: 5, top: 5, child: InkWell(onTap: _busy ? null : () => setState(() => _media.removeAt(i)), child: Container(padding: const EdgeInsets.all(4), decoration: const BoxDecoration(color: Color(0x99000000), shape: BoxShape.circle), child: const Icon(Icons.close, size: 14, color: Colors.white)))),
    ]);
  }
}
