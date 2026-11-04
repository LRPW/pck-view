use super::{Field, Kind, Reader, Result, TaskNode};

impl Reader<'_> {
    fn byte(&mut self) -> Result<usize> {
        let offset = self.take(1)?;
        Ok(self.bytes[offset] as usize)
    }

    fn dyn_text(&mut self, label: &str, section: &str, kind: Kind) -> Result<Field> {
        let key = self.pos;
        let units = match kind {
            Kind::Name => self.byte()?,
            Kind::TalkLabel => {
                let bytes = self.count()?;
                if bytes % 2 != 0 || bytes > 128 {
                    return Err("Некорректный текст диалога".into());
                }
                bytes / 2
            }
            _ => self.count()?,
        };
        let start = self.pos;
        self.skip(units, 2)?;
        Ok(Field {
            key,
            end: self.pos,
            label: label.into(),
            section: section.into(),
            kind,
            value: self.text(start, units, 0),
            code: 0,
        })
    }

    fn dyn_number(
        &mut self,
        fields: &mut Vec<Field>,
        size: usize,
        label: &str,
        section: &str,
        kind: Kind,
    ) -> Result<()> {
        let offset = self.take(size)?;
        fields.push(self.number(offset, label, section, kind));
        Ok(())
    }

    fn dyn_award(&mut self, fields: &mut Vec<Field>) -> Result<()> {
        let header = self.pos;
        let mask = self.count()?;
        let section = "Награда за успех";
        for (bit, label, kind) in [
            (0, "Монеты", Kind::UInt),
            (1, "Опыт", Kind::UInt),
            (2, "Дух", Kind::UInt),
            (3, "Репутация", Kind::Int),
        ] {
            if mask & (1 << bit) != 0 {
                self.dyn_number(fields, 4, label, section, kind)?;
            }
        }
        let group_start = self.pos;
        let count = if mask & 16 != 0 { self.byte()? } else { 0 };
        let mut groups = self.groups(count, header, section, true)?;
        groups.key = group_start | super::GROUP_KEY;
        groups.code = (group_start - header) as u16;
        fields.push(groups);
        if mask & 32 != 0 && self.byte()? != 0 {
            self.take(2)?;
            let count = self.byte()?;
            self.take(1)?;
            self.skip(count, 16)?;
        }
        if mask & 64 != 0 && self.byte()? != 0 {
            self.take(1)?;
            let count = self.byte()?;
            self.skip(count, 21)?;
        }
        Ok(())
    }

    fn dyn_node(&mut self, depth: usize) -> Result<TaskNode> {
        if depth >= 64 {
            return Err("Слишком глубокое дерево заданий".into());
        }
        let mask = self.count()?;
        self.take(4)?;
        let kind = self.byte()?;
        let special = if depth == 0 && matches!(kind, 1 | 3) {
            Some(self.take(4)?)
        } else {
            None
        };
        let id = self.count()? as u32;
        let name = self.dyn_text("Название", "Основное", Kind::Name)?;
        let title = name.value.clone();
        let mut fields = vec![name];
        if let Some(offset) = special {
            fields.push(self.number(offset, "Код специальной награды", "Основное", Kind::UInt));
        }
        for label in [
            "Выбрать одно подзадание",
            "Случайное подзадание",
            "Подзадания по порядку",
            "Провал родителя при провале подзадания",
            "Успех родителя при успехе подзадания",
            "Можно отказаться",
            "Повторяемое",
            "Повтор после провала",
            "Очистить при отказе",
            "Записывать завершение",
            "Провал при смерти",
            "Автоматическая выдача",
            "Срабатывает при смерти",
            "Очистить полученные предметы",
            "Требуется супруг",
            "Групповое задание",
            "Показывать направление",
        ] {
            self.dyn_number(&mut fields, 1, label, "Основное", Kind::Bool)?;
        }
        for label in ["Минимальный уровень", "Максимальный уровень"]
        {
            self.dyn_number(&mut fields, 1, label, "Условия", Kind::Byte)?;
        }
        for bit in 0..13 {
            if mask & (1 << bit) == 0 {
                continue;
            }
            let section = "Условия";
            match bit {
                0 => {
                    self.dyn_number(&mut fields, 4, "Лимит времени (сек.)", section, Kind::UInt)?
                }
                1 => self.dyn_number(&mut fields, 4, "Репутация", section, Kind::Int)?,
                2 => self.dyn_number(&mut fields, 2, "Период", section, Kind::UShort)?,
                3 | 6 => {
                    let count = self.byte()?;
                    if bit == 6 {
                        self.take(2)?;
                    }
                    let label = if bit == 3 {
                        "Требуемый предмет"
                    } else {
                        "Выдаваемый предмет"
                    };
                    for i in 0..count {
                        self.item(&mut fields, section, &format!("{label} {}", i + 1))?;
                    }
                }
                4 => {
                    self.dyn_number(&mut fields, 1, "Выдача в зоне", section, Kind::Bool)?;
                    self.dyn_number(&mut fields, 4, "Мир выдачи", section, Kind::UInt)?;
                    let count = self.count()?;
                    self.skip(count, 24)?;
                }
                5 => {
                    self.dyn_number(&mut fields, 1, "Телепортировать", section, Kind::Bool)?;
                    self.dyn_number(&mut fields, 4, "Мир телепортации", section, Kind::UInt)?;
                    for axis in ["X", "Y", "Z"] {
                        self.dyn_number(
                            &mut fields,
                            4,
                            &format!("Телепортация · {axis}"),
                            section,
                            Kind::Float,
                        )?;
                    }
                }
                7 => self.dyn_number(&mut fields, 4, "Залог", section, Kind::UInt)?,
                8 | 10 | 11 => {
                    let count = self.byte()?;
                    let label = match bit {
                        8 => {
                            self.dyn_number(
                                &mut fields,
                                1,
                                "Минимум выполненных заданий",
                                section,
                                Kind::Byte,
                            )?;
                            "Предыдущее задание (ID и флаг провала)"
                        }
                        10 => "ID класса",
                        _ => "Взаимоисключающее задание",
                    };
                    for i in 0..count {
                        self.dyn_number(
                            &mut fields,
                            4,
                            &format!("{label} {}", i + 1),
                            section,
                            Kind::UInt,
                        )?;
                    }
                }
                9 => self.dyn_number(&mut fields, 1, "Пол", section, Kind::Byte)?,
                12 => {
                    let count = self.byte()?;
                    self.skip(count, 49)?;
                }
                _ => unreachable!(),
            }
        }
        match self.byte()? {
            1 => {
                for i in 0..self.byte()? {
                    let offset = self.take(30)?;
                    for (delta, label) in [
                        (0, "ID монстра"),
                        (4, "Количество"),
                        (8, "ID выпадающего предмета"),
                        (12, "Количество предметов"),
                    ] {
                        fields.push(self.number(
                            offset + delta,
                            &format!("Монстр {} · {label}", i + 1),
                            "Цели",
                            Kind::UInt,
                        ));
                    }
                }
            }
            2 => {
                for i in 0..self.byte()? {
                    self.item(&mut fields, "Цели", &format!("Предмет {}", i + 1))?;
                }
                for (label, kind) in [
                    ("Требуется монет", Kind::UInt),
                    ("Вклад в гильдию", Kind::Int),
                    ("Опыт гильдии", Kind::Int),
                ] {
                    self.dyn_number(&mut fields, 4, label, "Цели", kind)?;
                }
            }
            4 => self.dyn_number(&mut fields, 4, "Мир цели", "Цели", Kind::UInt)?,
            11 => {
                self.dyn_number(&mut fields, 4, "Мир цели", "Цели", Kind::UInt)?;
                self.take(12)?;
            }
            5 => self.dyn_number(&mut fields, 4, "Время ожидания (сек.)", "Цели", Kind::UInt)?,
            _ => {}
        }
        self.dyn_number(&mut fields, 1, "Способ сдачи", "Цели", Kind::Byte)?;
        self.dyn_award(&mut fields)?;
        for label in ["Описание", "Текст успеха", "Текст провала"] {
            fields.push(self.dyn_text(label, "Тексты", Kind::Text)?);
        }
        for section in [
            "Диалог выдачи",
            "Диалог отказа",
            "Диалог выдачи предметов",
            "Диалог выполнения",
            "Диалог награды",
        ] {
            fields.push(self.talk(0, section, true)?);
        }
        let mut children = Vec::new();
        for _ in 0..self.count()? {
            children.push(self.dyn_node(depth + 1)?);
        }
        Ok(TaskNode {
            id,
            name: title,
            fields,
            children,
        })
    }
}

pub(in super::super) fn dynamic_offsets(bytes: &[u8], count: usize) -> Result<Vec<usize>> {
    let mut reader = Reader { bytes, pos: 12 };
    let mut offsets = Vec::new();
    for _ in 0..count {
        offsets.push(reader.pos);
        reader.dyn_node(0)?;
    }
    if reader.pos != bytes.len() {
        return Err("Границы динамических заданий не совпали".into());
    }
    Ok(offsets)
}

pub(in super::super) fn parse_dynamic(bytes: &[u8]) -> Result<TaskNode> {
    let mut reader = Reader { bytes, pos: 0 };
    let node = reader.dyn_node(0)?;
    if reader.pos != bytes.len() {
        return Err("Граница динамического задания не совпала".into());
    }
    Ok(node)
}

pub(in super::super) fn parse_npc(bytes: &[u8]) -> Result<TaskNode> {
    if bytes.len() != 12 {
        return Err("Некорректная запись NPC".into());
    }
    let reader = Reader { bytes, pos: 0 };
    let id = reader.u32(0);
    let fields: Vec<_> = [(4, "X"), (6, "Y"), (8, "Z")]
        .into_iter()
        .map(|(offset, axis)| reader.number(offset, axis, "Координаты", Kind::Short))
        .collect();
    let name = fields
        .iter()
        .map(|field| field.value.as_str())
        .collect::<Vec<_>>()
        .join(" · ");
    Ok(TaskNode {
        id,
        name,
        fields,
        children: Vec::new(),
    })
}
