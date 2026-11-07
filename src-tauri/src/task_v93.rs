// PW tasks.data v93 byte layout. The offsets are relative to the quest body,
// including its ID and UTF-16 name. Variable sections follow the 906-byte header.
use super::{Field, Kind, Reader, Result, TaskNode, NAME_UNITS};

impl Reader<'_> {
    pub(super) fn node_v93(&mut self, depth: usize) -> Result<TaskNode> {
        let start = self.take(906)?;
        let id = self.u32(start);
        let name = self.fixed_text(start + 4, NAME_UNITS, id as u16, "Name", "General");
        let title = name.value.clone();
        let mut fields = vec![name];
        for (offset, label, section) in [
            (69, "Quest type", "General"),
            (73, "Time limit (seconds)", "General"),
            (232, "Delivery NPC", "Delivery"),
            (236, "Award NPC", "Delivery"),
            (316, "Minimum level", "Requirements"),
            (320, "Maximum level", "Requirements"),
            (708, "Completion method", "Completion"),
        ] {
            fields.push(self.number(start + offset, label, section, Kind::UInt));
        }
        if self.bytes[start + 64] != 0 {
            let signature = self.take(60)?;
            fields.push(self.fixed_text(signature, NAME_UNITS, id as u16, "Signature", "General"));
        }
        for (offset, stride) in [
            (105, 48),
            (244, 9),
            (279, 576),
            (293, 16),
            (169, 24),
            (182, 24),
            (195, 24),
        ] {
            self.skip(self.u32(start + offset) as usize, stride)?;
        }
        for (offset, section) in [(325, "Requirements"), (334, "Delivery")] {
            for index in 0..self.u32(start + offset) {
                self.item(&mut fields, section, &format!("Item {}", index + 1))?;
            }
        }
        self.skip(self.u32(start + 654) as usize, 32)?;
        for index in 0..self.u32(start + 716) {
            let monster = self.take(30)?;
            for (offset, label, kind) in [
                (0, "Monster ID", Kind::UInt),
                (4, "Quantity", Kind::UInt),
                (8, "Drop item ID", Kind::UInt),
                (12, "Drop quantity", Kind::UInt),
                (16, "Common item", Kind::Bool),
                (17, "Probability", Kind::Float),
                (22, "DPH", Kind::Int),
                (26, "DPS", Kind::Int),
            ] {
                fields.push(self.number(
                    monster + offset,
                    &format!("Monster {} · {label}", index + 1),
                    "Completion",
                    kind,
                ));
            }
        }
        for index in 0..self.u32(start + 724) {
            self.item(&mut fields, "Completion", &format!("Item {}", index + 1))?;
        }
        for (offset, stride) in [(833, 576), (845, 128), (764, 24), (780, 24)] {
            self.skip(self.u32(start + offset) as usize, stride)?;
        }
        self.award_v93(&mut fields, "Success reward")?;
        self.award_v93(&mut fields, "Failure reward")?;
        for (section, bytes) in [
            ("By time · success", 20),
            ("By time · failure", 20),
            ("By items · success", 24),
            ("By items · failure", 24),
        ] {
            let count = self.count()?;
            if count > 5 {
                return Err("Invalid reward tier count".into());
            }
            self.take(bytes)?;
            for index in 0..count {
                self.award_v93(&mut fields, &format!("{section} · {}", index + 1))?;
            }
        }
        self.node_tail(id, title, fields, depth, 93)
    }

    fn award_v93(&mut self, fields: &mut Vec<Field>, section: &str) -> Result<()> {
        let start = self.take(208)?;
        for (offset, label, kind) in [
            (0, "Coins", Kind::UInt),
            (4, "Experience", Kind::UInt),
            (8, "New quest ID", Kind::UInt),
            (12, "Spirit", Kind::UInt),
            (16, "Reputation", Kind::Int),
        ] {
            fields.push(self.number(start + offset, label, section, kind));
        }
        fields.push(self.groups(self.u32(start + 84) as usize, start + 84, section, false)?);
        for (offset, header, stride) in [
            (92, 6, 16),
            (147, 1, 21),
            (155, 0, 9),
            (180, 0, 4),
            (188, 0, 576),
            (200, 0, 128),
        ] {
            let count = self.u32(start + offset) as usize;
            if count != 0 {
                self.take(header)?;
                self.skip(count, stride)?;
            }
        }
        Ok(())
    }
}
