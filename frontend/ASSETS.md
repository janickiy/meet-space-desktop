# Визуальные материалы MeetSpace Desktop

## Фирменные значки

`public/branding/` содержит набор SVG MeetSpace, предоставленный владельцем проекта 16 октября 2026 года, и совместимые адреса значков. Производные значки приложения, трея и установщиков находятся в `desktop/resources/`. Источник, преобразование и контрольные суммы записаны в `desktop/resources/icon-source.json`. Эти материалы не получают лицензию сторонних библиотек автоматически.

## Изображения интерфейса

- `public/media/auth-landscape.jpg` — локальный фон, перенесённый из исходного интерфейса MeetSpace; используется в оформлении рабочего пространства и встреч. Отдельное подтверждение происхождения или новой лицензии этим документом не добавляется.
- `public/media/meetspace-group-chat-v5.webp` — декоративная иллюстрация группового разговора для приветственного экрана. Создана встроенным `image_gen`, новый непрозрачный результат, 1536 × 1024, преобразована в WebP с качеством 87 без визуального редактирования. Исходный результат: `exec-2ec95f05-58bf-4944-aeb4-b98018a6b24b.png`. Иллюстрация не является снимком реального звонка.

Промпт сохранён вместе с используемым изображением:

```text
Use case: photorealistic-natural.
Asset type: an edge-to-edge photograph mosaic for the content area of a group video chat illustration on the MeetSpace homepage.
Primary request: four distinct people having a friendly group video conversation, in a precise equal 2 by 2 grid. The output is ONLY the four webcam portraits, not an app mockup.
Composition: landscape 3:2. Exactly four equally sized rectangular tiles fill the entire canvas. Thin straight 6px muted dark-plum dividers at the vertical and horizontal centers. Each tile is a separate home office webcam view with a single person centered, head and upper torso fully visible, comfortable headroom; faces the same natural scale.
Top left: a woman about 30, shoulder-length wavy chestnut hair, sage-green shirt, warm genuine smile, airy home studio with books and a plant.
Top right: a man about 35 with short dark hair and glasses, navy overshirt, attentive expression, softly lit neutral office background.
Bottom left: a woman about 40 with dark curly hair and a cream blouse, smiling naturally, warm home interior.
Bottom right: a man about 45 with short light-brown hair and subtle beard, light-blue shirt, a friendly relaxed smile, tidy home office.
Style: photorealistic polished editorial photography, believable natural window light, natural skin texture and fabric, consistent calm muted color palette, varied natural expressions rather than identical stock smiles.
Constraints: four people in four separate rooms, one per tile; no hands in foreground, no floating objects, no laptop, no monitor casing, no outer frame, no perspective tilt, no interface controls, no text, no names, no logos, no watermark. Tile borders must be exactly straight and grid equal. All four faces unobscured. Opaque image.
```

## Лицензии зависимостей

Иконки `lucide-react` распространяются по ISC, локальные файлы шрифта Inter из `@fontsource/inter` — по SIL Open Font License. Полные тексты из установленных зависимостей формируются при сборке в `desktop/resources/THIRD_PARTY_NOTICES.txt`, инвентарь — в `desktop/resources/third-party-licenses.json`. Уведомления Electron и Chromium поставляются отдельно в установочном пакете. Визуальные ресурсы загружаются локально.
