// SPDX-License-Identifier: GPL-3.0-only
// Schema adapted from MyAceEditor TaskLayout.Gen.cs (GPL-3.0).
// https://github.com/ipasetto/MyAceEditor/blob/f2513f1058f4b4465f1e12ba690a90b2f268dce9/PerfectWorld/TaskLayout.Gen.cs
#![allow(non_snake_case, unused_variables, unused_parens)]
use super::*;

pub(super) fn Fixed(v: &mut Schema<'_>, version: i64) -> Result<()> {
    F01(v, version)?;
    F02(v, version)?;
    F03(v, version)?;
    F04(v, version)?;
    F05(v, version)?;
    F06(v, version)?;
    F07(v, version)?;
    F08(v, version)?;
    F09(v, version)?;
    F10(v, version)?;
    F11(v, version)?;
    F12(v, version)?;
    F13(v, version)?;
    F14(v, version)?;
    F15(v, version)?;
    F16(v, version)?;
    F17(v, version)?;
    F18(v, version)?;
    F19(v, version)?;
    F20(v, version)?;
    F21(v, version)?;
    F22(v, version)?;
    F23(v, version)?;
    F24(v, version)?;
    F25(v, version)?;
    F26(v, version)?;
    F27(v, version)?;
    F28(v, version)?;
    F29(v, version)?;
    F30(v, version)?;
    F31(v, version)?;
    F32(v, version)?;
    F33(v, version)?;
    F34(v, version)?;
    F35(v, version)?;
    F36(v, version)?;
    F37(v, version)?;
    F38(v, version)?;
    F39(v, version)?;
    F40(v, version)?;
    F41(v, version)?;
    F42(v, version)?;
    F43(v, version)?;
    F44(v, version)?;
    F45(v, version)?;
    F46(v, version)?;
    F47(v, version)?;
    F48(v, version)?;
    F49(v, version)?;
    F50(v, version)?;
    F51(v, version)?;
    F52(v, version)?;
    F53(v, version)?;
    F54(v, version)?;
    F55(v, version)?;
    F56(v, version)?;
    F57(v, version)?;
    F58(v, version)?;
    Ok(())
}

fn F01(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 153 {
        v.I16("m_usIDSpace")?;
    }
    v.I32("m_ID")?;
    v.Str16("m_szName", 30)?;
    if version < 135 {
        v.Bool("m_bHasSign")?;
    }
    if version < 176 {
        v.I32("m_pszSignaturePointer")?;
    }
    v.I32("m_ulType")?;
    v.I32("m_ulTimeLimit")?;
    Ok(())
}

fn F02(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 68 {
        if version < 135 {
            v.Bool("m_bOfflineFail")?;
        }
        v.Bool("m_bAbsFail")?;
        v.scope("m_tmAbsFailTime", |v| L_task_tm(v, version))?;
        if version >= 175 {
            v.Bool("m_bNextTimeFail")?;
            v.scope("m_tmNextFailTime", |v| L_task_tm(v, version))?;
        }
        if version < 135 {
            v.Bool("m_bItemNotTakeOff")?;
        }
    }
    if version >= 52 && version < 135 {
        v.Bool("m_bAbsTime")?;
    }
    v.I32("m_ulTimetable")?;
    if version >= 52 {
        let maxTimetableSize = GetMaxTimetableSize(version);
        for i in 0..v.limit(maxTimetableSize)? {
            v.U8(&format!("m_tmType[{i}]"))?;
        }
    }
    if version < 176 {
        v.I32("m_tmStartPointer")?;
        v.I32("m_tmEndPointer")?;
    }
    if version >= 52 {
        v.I32("m_lAvailFrequency")?;
        v.I32("m_lFrequencyNum")?;
    }
    if version >= 191 {
        v.I32("m_lPeriodLimit")?;
    }
    if version >= 175 {
        v.Bool("m_bAvailFrequency")?;
        v.scope("m_tmAvailFrequency", |v| L_task_tm(v, version))?;
    }
    Ok(())
}

fn F03(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version < 135 {
        v.Bool("m_bChooseOne")?;
        v.Bool("m_bRandOne")?;
        v.Bool("m_bExeChildInOrder")?;
        v.Bool("m_bParentAlsoFail")?;
        v.Bool("m_bParentAlsoSucc")?;
        v.Bool("m_bCanGiveUp")?;
        v.Bool("m_bCanRedo")?;
        v.Bool("m_bCanRedoAfterFailure")?;
        v.Bool("m_bClearAsGiveUp")?;
        v.Bool("m_bNeedRecord")?;
        v.Bool("m_bFailAsPlayerDie")?;
    }
    v.I32("m_ulMaxReceiver")?;
    if version < 135 {
        v.Bool("m_bDelvInZone")?;
    }
    v.I32("m_ulDelvWorld")?;
    Ok(())
}

fn F04(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 80 {
        v.I32("m_ulDelvRegionCnt")?;
        if version < 176 {
            v.I32("m_pDelvRegionPointer")?;
        }
    } else {
        v.Set("m_ulDelvRegionCnt", 1); // derivado (não está no arquivo)
        v.scope("m_pDelvRegion[0]", |v| L_Task_Region(v, version))?;
        v.Set("m_pDelvRegion[0].MapID", v.N("m_ulDelvWorld")); // derivado (não está no arquivo)
    }
    Ok(())
}

fn F05(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 68 {
        if version < 135 {
            v.Bool("m_bEnterRegionFail")?;
        }
        v.I32("m_ulEnterRegionWorld")?;
        if version >= 80 {
            v.I32("m_ulEnterRegionCnt")?;
            if version < 176 {
                v.I32("m_pEnterRegionPointer")?;
            }
        } else {
            v.Set("m_ulEnterRegionCnt", 1); // derivado (não está no arquivo)
            v.scope("m_pEnterRegion[0]", |v| L_Task_Region(v, version))?;
            v.Set("m_pEnterRegion[0].MapID", v.N("m_ulEnterRegionWorld")); // derivado (não está no arquivo)
        }
    } else {
    }
    Ok(())
}

fn F06(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 68 {
        if version < 135 {
            v.Bool("m_bLeaveRegionFail")?;
        }
        v.I32("m_ulLeaveRegionWorld")?;
        if version >= 80 {
            v.I32("m_ulLeaveRegionCnt")?;
            if version < 176 {
                v.I32("m_pLeaveRegionPointer")?;
            }
        } else {
            v.Set("m_ulLeaveRegionCnt", 1); // derivado (não está no arquivo)
            v.scope("m_pLeaveRegion[0]", |v| L_Task_Region(v, version))?;
            v.Set("m_pLeaveRegion[0].MapID", v.N("m_ulLeaveRegionWorld")); // derivado (não está no arquivo)
        }
    } else {
    }
    Ok(())
}

fn F07(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 97 && version < 135 {
        v.Bool("m_bLeaveForceFail")?;
    }
    if version < 135 {
        v.Bool("m_bTransTo")?;
    }
    v.I32("m_ulTransWldId")?;
    v.scope("m_TransPt", |v| L_ZONE_VERT(v, version))?;
    if version >= 52 {
        v.I32("m_lMonsCtrl")?;
        if version < 135 {
            v.Bool("m_bTrigCtrl")?;
        }
    }
    Ok(())
}

fn F08(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version < 135 {
        v.Bool("m_bAutoDeliver")?;
        if version >= 84 {
            v.Bool("m_bDisplayInExclusiveUI")?;
        }
        if version >= 89 {
            v.Bool("m_bReadyToNotifyServer")?;
        }
        if version >= 116 {
            v.Bool("m_bUsedInTokenShop")?;
        }
        v.Bool("m_bDeathTrig")?;
        v.Bool("m_bClearAcquired")?;
    }
    v.I32("m_ulSuitableLevel")?;
    if version < 135 {
        v.Bool("m_bShowPrompt")?;
        v.Bool("m_bKeyTask")?;
    }
    v.I32("m_ulDelvNPC")?;
    v.I32("m_ulAwardNPC")?;
    Ok(())
}

fn F09(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if (version >= 187)
    // RAE: 198; v187 (Maori 1.7.2) provado; 135-186 sem arquivo para provar
    {
        v.I32("m_ulChangeKeyCnt")?;
        v.I32("m_ulChangePersonKeyCnt")?;
        v.I32("m_ulChangeHistoryKeyCnt")?;
    }
    Ok(())
}

fn F10(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version < 135 {
        v.Bool("m_bSkillTask")?;
        if version >= 52 {
            v.Bool("m_bCanSeekOut")?;
            v.Bool("m_bShowDirection")?;
        }
        if version >= 55 {
            v.Bool("m_bMarriage")?;
        }
    }
    if version >= 59 && version < 135
    // task change-key count
    {
        v.I32("m_ulChangeKeyCnt")?;
        if version < 176 {
            v.I32("m_plChangeKeyPointer")?;
            v.I32("m_plChangeKeyValuePointer")?;
            v.I32("m_pbChangeTypePointer")?;
        }
    }
    if version >= 63 && version < 135 {
        v.Bool("m_bSwitchSceneFail")?;
        v.Bool("m_bHidden")?;
    }
    if version >= 78 {
        if version < 135 {
            v.Bool("m_bDeliverySkill")?;
        }
        v.I32("m_iDeliveredSkillID")?;
        v.I32("m_iDeliveredSkillLevel")?;
        if version < 135 {
            v.Bool("m_bShowGfxFinished")?;
        }
    }
    if version >= 79 && version < 135 {
        v.Bool("m_bChangePQRanking")?;
    }
    if version >= 81 {
        if version < 135 {
            v.Bool("m_bCompareItemAndInventory")?;
        }
        v.I32("m_ulInventorySlotNum")?;
    }
    Ok(())
}

fn F11(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version < 135 {
        if version >= 123 {
            v.Bool("m_bTowerTask")?;
        }
        if version >= 126 {
            v.Bool("m_bHomeTask")?;
        }
        if version >= 128 {
            v.Bool("m_bDeliverInHostHome")?;
            v.Bool("m_bFinishInHostHome")?;
        }
    }
    Ok(())
}

fn F12(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 75 {
        if version < 135 {
            v.Bool("m_bPQTask")?;
        }
        v.I32("m_ulPQExpCnt")?;
        if version < 176 {
            v.I32("m_pszPQExpPointer")?;
            v.I32("m_pPQExpArrPointer")?;
        }
        if version < 135 {
            v.Bool("m_bPQSubTask")?;
            v.Bool("m_bClearContrib")?;
        }
        v.I32("m_ulMonsterContribCnt")?;
        if version < 176 {
            v.I32("m_MonstersContribPointer")?;
        }
    }
    Ok(())
}

fn F13(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 91 {
        v.I32("m_iPremNeedRecordTasksNum")?;
        if version < 135 {
            v.Bool("m_bShowByNeedRecordTasksNum")?;
        }
    }
    if version >= 87 {
        v.I32("m_iPremiseFactionContrib")?;
        if version < 135 {
            v.Bool("m_bShowByFactionContrib")?;
        }
    }
    if version < 135 {
        if version >= 75 {
            v.Bool("m_bAccountTaskLimit")?;
        }
        if version >= 115 {
            v.Bool("m_bRoleTaskLimit")?;
        }
    }
    if version >= 75 {
        v.I32("m_ulAccountTaskLimitCnt")?;
    }
    Ok(())
}

fn F14(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version < 135 {
        if version >= 105 {
            v.Bool("m_bLeaveFactionFail")?;
        }
        if version >= 111 {
            v.Bool("m_bNotIncCntWhenFailed")?;
        }
        if version >= 108 {
            v.Bool("m_bNotClearItemWhenFailed")?;
        }
        if version >= 110 {
            v.Bool("m_bDisplayInTitleTaskUI")?;
        }
    }
    if version >= 146 {
        v.I32("m_iFactionMember")?;
    }
    Ok(())
}

fn F15(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 161 {
        v.I32("m_ulCrossServerId")?;
        v.I32("m_ulIconStateIDForAwardVar")?;
        v.I32("m_lGlobalKeyForAwardVar")?;
    }
    if version >= 178 {
        v.I32("m_lPersonKeyForAwardVar")?;
    }
    if version >= 185 {
        v.I32("m_lHistoryKeyForAwardVar")?;
    }
    Ok(())
}

fn F16(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 175 {
        v.Bool("m_bPropNeedComp")?;
        v.I32("m_nPropExp1AndOrExp2")?;
        v.scope("m_Prop1KeyValue", |v| L_COMPARE_KEY_VALUE(v, version))?;
        v.scope("m_Prop2KeyValue", |v| L_COMPARE_KEY_VALUE(v, version))?;
    }
    if version >= 189 {
        v.Bool("m_bPropNeedComp_personal")?;
        v.I32("m_nPropExp1AndOrExp2_personal")?;
        v.scope("m_Prop1KeyValue_personal", |v| {
            L_COMPARE_KEY_VALUE(v, version)
        })?;
        v.scope("m_Prop2KeyValue_personal", |v| {
            L_COMPARE_KEY_VALUE(v, version)
        })?;
    }
    Ok(())
}

fn F17(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 180 {
        v.I32("m_iHideOtherPlayerTime")?;
        v.I32("m_ulPropSummonedMonsters")?;
    }
    if version < 182 {
        v.scope("PropMonsterSummoned", |v| {
            L_AWARD_MONSTERS_SUMMONED2(v, version)
        })?;
    }
    if version >= 181 {
        v.I32("m_iGfxType")?;
    }
    if version >= 198 {
        v.F32("m_fVaguePromptRadius")?;
        v.F32("m_fVaguePromptX")?;
        v.F32("m_fVaguePromptY")?;
        if version >= 215 {
            v.U32("m_ulVaguePromptNumbers")?;
        }
    }
    if version >= 240 {
        v.I32("m_iCameraMovementID")?;
    }
    Ok(())
}

fn F18(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 96 {
        v.U8("m_ucPremiseTransformedForm")?;
        if version < 135 {
            v.Bool("m_bShowByTransformed")?;
        }
    }
    v.I32("m_ulPremise_Lev_Min")?;
    v.I32("m_ulPremise_Lev_Max")?;
    if version >= 113 {
        v.I32("m_bPremCheckMaxHistoryLevel")?;
    }
    if version < 135 {
        v.Bool("m_bShowByLev")?;
    }
    if version >= 113 {
        if version < 135 {
            v.Bool("m_bPremCheckReincarnation")?;
        }
        v.I32("m_ulPremReincarnationMin")?;
        v.I32("m_ulPremReincarnationMax")?;
        if version < 135 {
            v.Bool("m_bShowByReincarnation")?;
            v.Bool("m_bPremCheckRealmLevel")?;
        }
        v.I32("m_ulPremRealmLevelMin")?;
        v.I32("m_ulPremRealmLevelMax")?;
        if version < 135 {
            v.Bool("m_bPremCheckRealmExpFull")?;
            v.Bool("m_bShowByRealmLevel")?;
        }
    }
    Ok(())
}

fn F19(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 227 {
        v.U32("m_ulChangeSceneRemoveItemRegionNum")?;
        v.U32("m_ulChangeSceneRemoveNum")?;
    }
    v.I32("m_ulPremItems")?;
    if version < 176 {
        v.I32("m_PremItemsPointer")?;
    }
    if version < 135 {
        v.Bool("m_bShowByItems")?;
        if version >= 98 {
            v.Bool("m_bPremItemsAnyOne")?;
        }
    }
    v.I32("m_ulGivenItems")?;
    v.I32("m_ulGivenCmnCount")?;
    v.I32("m_ulGivenTskCount")?;
    if version >= 215 {
        v.U32("m_ulGivenRelicCount")?;
        v.U32("m_ulGivenDongluCmnCount")?;
    }
    if version < 176 {
        v.I32("m_GivenItemsPointer")?;
    }
    Ok(())
}

fn F20(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulPremise_Deposit")?;
    if version < 135 {
        v.Bool("m_bShowByDeposit")?;
    }
    v.I32("m_lPremise_Reputation")?;
    if version >= 53 {
        v.I32("m_lPremise_RepuMax")?;
    }
    if version < 135 {
        v.Bool("m_bShowByRepu")?;
    }
    Ok(())
}

fn F21(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulPremise_Task_Count")?;
    let maxPremTaskCount = GetMaxPremTaskCount(version);
    for i in 0..v.limit(maxPremTaskCount)? {
        v.I32(&format!("m_ulPremise_Tasks[{i}]"))?;
    }
    if version >= 153 {
        for j in 0..v.limit(maxPremTaskCount)? {
            v.I16(&format!("m_usPremise_Tasks_Space[{j}]"))?;
        }
    }
    if version < 135 {
        v.Bool("m_bShowByPreTask")?;
    }
    if version >= 90 {
        v.I32("m_ulPremise_Task_Least_Num")?;
    }
    v.I32("m_ulPremise_Period")?;
    if version < 135 {
        v.Bool("m_bShowByPeriod")?;
    }
    Ok(())
}

fn F22(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulPremise_Faction")?;
    if version >= 93 {
        v.I32("m_iPremise_FactionRole")?;
    }
    if version < 135 {
        v.Bool("m_bShowByFaction")?;
    }
    v.I32("m_ulGender")?;
    if version < 135 {
        v.Bool("m_bShowByGender")?;
    }
    v.I32("m_ulOccupations")?;
    let maxOccupations = GetMaxOccupations(version);
    for i in 0..v.limit(maxOccupations)? {
        v.I32(&format!("m_Occupations[{i}]"))?;
    }
    if version < 135 {
        v.Bool("m_bShowByOccup")?;
        v.Bool("m_bPremise_Spouse")?;
        v.Bool("m_bShowBySpouse")?;
        if version >= 102 {
            v.Bool("m_bPremiseWeddingOwner")?;
            v.Bool("m_bShowByWeddingOwner")?;
        }
    }
    Ok(())
}

fn F23(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version < 135 {
        if version >= 52 {
            v.Bool("m_bGM")?;
        }
        if version >= 68 {
            v.Bool("m_bShieldUser")?;
        }
    }
    if version >= 75 {
        if version < 135 {
            v.Bool("m_bShowByRMB")?;
        }
        v.I32("m_ulPremRMBMin")?;
        v.I32("m_ulPremRMBMax")?;
        if version < 135 {
            v.Bool("m_bCharTime")?;
            v.Bool("m_bShowByCharTime")?;
        }
        v.I32("m_iCharStartTime")?;
        v.I32("m_iCharEndTime")?;
        v.scope("m_tmCharEndTime", |v| L_task_tm(v, version))?;
        v.I32("m_ulCharTimeGreaterThan")?;
    }
    Ok(())
}

fn F24(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 153 {
        v.I16("m_usPremise_Cotask_Space")?;
    }
    v.I32("m_ulPremise_Cotask")?;
    v.I32("m_ulCoTaskCond")?;
    v.I32("m_ulMutexTaskCount")?;
    let maxMutexTasks = GetMaxMutexTasks(version);
    if version >= 153 {
        for i in 0..v.limit(maxMutexTasks)? {
            v.I16(&format!("m_usMutexTasksSpace[{i}]"))?;
        }
    }
    for j in 0..v.limit(maxMutexTasks)? {
        v.I32(&format!("m_ulMutexTasks[{j}]"))?;
    }
    for k in 0..v.limit((4))? {
        v.I32(&format!("m_lSkillLev[{k}]"))?;
    }
    v.U8("m_DynTaskType")?;
    v.I32("m_ulSpecialAward")?;
    Ok(())
}

fn F25(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version < 135 {
        v.Bool("m_bTeamwork")?;
        v.Bool("m_bRcvByTeam")?;
        v.Bool("m_bSharedTask")?;
        v.Bool("m_bSharedAchieved")?;
        v.Bool("m_bCheckTeammate")?;
    }
    v.F32("m_fTeammateDist")?;
    if version < 135 {
        v.Bool("m_bAllFail")?;
        v.Bool("m_bCapFail")?;
        v.Bool("m_bCapSucc")?;
    }
    v.F32("m_fSuccDist")?;
    if version < 135 {
        v.Bool("m_bDismAsSelfFail")?;
        v.Bool("m_bRcvChckMem")?;
    }
    Ok(())
}

fn F26(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.F32("m_fRcvMemDist")?;
    if version < 135 {
        v.Bool("m_bCntByMemPos")?;
    }
    v.F32("m_fCntMemDist")?;
    if version < 135 {
        if version >= 68 {
            v.Bool("m_bAllSucc")?;
        }
        if version >= 75 {
            v.Bool("m_bCoupleOnly")?;
        }
        if version >= 86 {
            v.Bool("m_bDistinguishedOcc")?;
        }
    }
    v.I32("m_ulTeamMemsWanted")?;
    if version < 176 {
        v.I32("m_TeamMemsWantedPointer")?;
    }
    if version < 135 {
        v.Bool("m_bShowByTeam")?;
    }
    Ok(())
}

fn F27(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 59 {
        if version < 135 {
            v.Bool("m_bPremNeedComp")?;
        }
        v.I32("m_nPremExp1AndOrExp2")?;
        v.scope("m_Prem1KeyValue", |v| L_COMPARE_KEY_VALUE(v, version))?;
        v.scope("m_Prem2KeyValue", |v| L_COMPARE_KEY_VALUE(v, version))?;
    }
    if version >= 178 {
        v.I32("m_nPremPersonExp1AndOrExp2")?;
        v.scope("m_Prem1PersonKeyValue", |v| L_COMPARE_KEY_VALUE(v, version))?;
        v.scope("m_Prem2PersonKeyValue", |v| L_COMPARE_KEY_VALUE(v, version))?;
    }
    if version >= 185 {
        v.I32("m_nPremHistoryExp1AndOrExp2")?;
        v.scope("m_Prem1HistoryKeyValue", |v| {
            L_COMPARE_KEY_VALUE(v, version)
        })?;
        v.scope("m_Prem2HistoryKeyValue", |v| {
            L_COMPARE_KEY_VALUE(v, version)
        })?;
    }
    Ok(())
}

fn F28(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 97 {
        if version < 135 {
            v.Bool("m_bPremCheckForce")?;
        }
        v.I32("m_iPremForce")?;
        if version < 135 {
            v.Bool("m_bShowByForce")?;
        }
        v.I32("m_iPremForceReputation")?;
        if version < 135 {
            v.Bool("m_bShowByForceReputation")?;
        }
        v.I32("m_iPremForceContribution")?;
        if version < 135 {
            v.Bool("m_bShowByForceContribution")?;
        }
        v.I32("m_iPremForceExp")?;
        if version < 135 {
            v.Bool("m_bShowByForceExp")?;
        }
        v.I32("m_iPremForceSP")?;
        if version < 135 {
            v.Bool("m_bShowByForceSP")?;
        }
    }
    if version >= 99 {
        v.I32("m_iPremForceActivityLevel")?;
        if version < 135 {
            v.Bool("m_bShowByForceActivityLevel")?;
        }
    }
    if version < 135 {
        if version >= 106 {
            v.Bool("m_bPremIsKing")?;
            v.Bool("m_bShowByKing")?;
        }
        if version >= 107 {
            v.Bool("m_bPremNotInTeam")?;
            v.Bool("m_bShowByNotInTeam")?;
        }
    }
    Ok(())
}

fn F29(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 109 {
        v.I32("m_iPremTitleNumTotal")?;
        v.I32("m_iPremTitleNumRequired")?;
        if version < 176 {
            v.I32("m_PremTitlesPointer")?;
        }
        if version < 135 {
            v.Bool("m_bShowByTitle")?;
        }
    }
    if version >= 112 {
        for i in 0..v.limit((2))? {
            v.I32(&format!("m_iPremHistoryStageIndex[{i}]"))?;
        }
    }
    if version < 135 && version >= 118 {
        v.Bool("m_bShowByHistoryStage")?;
    }
    if version >= 114 {
        v.I32("m_ulPremGeneralCardCount")?;
        if version < 135 {
            v.Bool("m_bShowByGeneralCard")?;
        }
    }
    if version >= 117 {
        v.I32("m_iPremGeneralCardRank")?;
        v.I32("m_ulPremGeneralCardRankCount")?;
        if version < 135 {
            v.Bool("m_bShowByGeneralCardRank")?;
        }
    }
    if version >= 122 {
        v.I32("m_ulPremIconStateID")?;
        if version < 135 {
            v.Bool("m_bShowByIconStateID")?;
        }
    }
    if version >= 237 {
        v.I32("m_ulFailIconStateID")?;
    }
    if version >= 125 {
        v.I32("m_iVIPLevelMin")?;
        v.I32("m_iVIPLevelMax")?;
        if version < 135 {
            v.Bool("m_bShowByVIPLevel")?;
        }
    }
    Ok(())
}

fn F30(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 129 && version < 135 {
        v.Bool("m_bPremNoHome")?;
    }
    if version >= 126 {
        v.I32("m_iPremHomeLevelMin")?;
        v.I32("m_iPremHomeLevelMax")?;
        if version < 135 {
            v.Bool("m_bShowByHomeLevel")?;
        }
        v.I32("m_iPremHomeResourceLevelType")?;
        v.I32("m_iPremHomeResourceLevelMin")?;
        v.I32("m_iPremHomeResourceLevelMax")?;
        if version < 135 {
            v.Bool("m_bShowByHomeResourceLevel")?;
        }
        v.I32("m_iPremHomeFactoryLevelType")?;
        v.I32("m_iPremHomeFactoryLevelMin")?;
        v.I32("m_iPremHomeFactoryLevelMax")?;
        if version < 135 {
            v.Bool("m_bShowByHomeFactoryLevel")?;
        }
        v.I32("m_iPremHomeFlourishMin")?;
        v.I32("m_iPremHomeFlourishMax")?;
        if version < 135 {
            v.Bool("m_bShowByHomeFlourish")?;
            v.Bool("m_bPremHomeStorageTask")?;
            v.Bool("m_bShowByHomeStorageTask")?;
        }
    }
    Ok(())
}

fn F31(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 137 {
        v.I32("m_iPremArenaWinCount")?;
    }
    if version >= 146 {
        v.I32("m_iPremFactionScore")?;
        v.I32("m_iPremFactionMoney")?;
        v.I32("m_iPremFactionPersonScore")?;
    }
    if version >= 153 {
        v.I32("m_iPremMentorMorality")?;
        v.I32("m_iPremMentorStudentValue")?;
    }
    if version >= 156 {
        v.I32("m_iPremCoupleIntimacy")?;
    }
    if version >= 158 {
        v.I32("m_ulPremDeposit2")?;
    }
    if version >= 161 {
        v.I32("m_ulNeededTaskCount")?;
        let maxNeededTasks = GetMaxNeededTasks(version);
        for i in 0..v.limit(maxNeededTasks)? {
            v.I16(&format!("m_usNeededTasksSpace[{i}]"))?;
        }
        for j in 0..v.limit(maxNeededTasks)? {
            v.I32(&format!("m_ulNeededTasks[{j}]"))?;
        }
        v.U8("m_iNeededTasksLeastNum")?;
    }
    if version >= 167 {
        v.I32("m_iCamp")?;
        v.I32("m_iCampPower")?;
        v.I32("m_iNeedFriendPoint")?;
    }
    if version >= 175 {
        v.I32("m_iRankType")?;
        v.I32("m_iRankGradeMin")?;
        v.I32("m_iRankGradeMax")?;
    }
    if version >= 198 {
        v.U32("m_ulPremPanguLevelMin")?;
        v.U32("m_ulPremPanguLevelMax")?;
        if version >= 215 {
            v.U32("m_ulPremPanguLevelYear")?;
        }
        v.I32("m_iAchievementSeriesId")?;
        if version >= 215 {
            v.I32("m_iPanguEquipYear")?;
            v.I32("m_iPanguEquipSlot")?;
            v.I32("m_iPanguEquipQuality")?;
            v.I32("m_iPanguEquipLevel")?;
        }
        if version >= 218 {
            v.U8("m_cPremInventorySizeMin")?;
            v.U8("m_cPremInventorySizeMax")?;
            v.U8("m_cPremStorageSizeMin")?;
            v.U8("m_cPremStorageSizeMax")?;
        }
        if version >= 223 {
            v.I32("m_iPremLieMoLevelMin")?;
            v.I32("m_iPremLieMoLevelMax")?;
            v.I32("m_iPremYuMoLevelMin")?;
            v.I32("m_iPremYuMoLevelMax")?;
            v.U8("m_cEffectiveGameServer")?;
        }
        if version >= 229 {
            v.I32("m_iPremDailyActivityValue")?;
        }
    }
    Ok(())
}

fn F32(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 195 {
        v.U32("m_ulMonsterUnwanted")?;
    }
    v.I32("m_enumMethod")?;
    v.I32("m_enumFinishType")?;
    if version >= 103 {
        v.I32("m_ulPlayerWanted")?;
        if version < 176 {
            v.I32("m_PlayerWantedPointer")?;
        }
    }
    v.I32("m_ulMonsterWanted")?;
    if version < 176 {
        v.I32("m_MonsterWantedPointer")?;
    }
    v.I32("m_ulItemsWanted")?;
    if version < 176 {
        v.I32("m_ItemsWantedPointer")?;
    }
    v.I32("m_ulGoldWanted")?;
    if version >= 88 {
        v.I32("m_iFactionContribWanted")?;
    }
    if version >= 89 {
        v.I32("m_iFactionExpContribWanted")?;
    }
    Ok(())
}

fn F33(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulNPCToProtect")?;
    v.I32("m_ulProtectTimeLen")?;
    v.I32("m_ulNPCMoving")?;
    v.I32("m_ulNPCDestSite")?;
    Ok(())
}

fn F34(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 80 {
        if version < 176 {
            v.I32("m_pReachSitePointer")?;
        }
        v.I32("m_ulReachSiteCnt")?;
        v.I32("m_ulReachSiteId")?;
    } else {
        v.Set("m_ulReachSiteCnt", 1); // derivado (não está no arquivo)
        v.scope("m_pReachSite[0]", |v| L_Task_Region(v, version))?;
        v.I32("m_ulReachSiteId")?;
        v.Set("m_pReachSite[0].MapID", v.N("m_ulReachSiteId")); // derivado (não está no arquivo)
    }
    v.I32("m_ulWaitTime")?;
    if version >= 94 {
        v.scope("m_TreasureStartZone", |v| L_ZONE_VERT(v, version))?;
        v.U8("m_ucZonesNumX")?;
        v.U8("m_ucZonesNumZ")?;
        v.U8("m_ucZoneSide")?;
    }
    if version >= 137 {
        v.I16("m_usZoneMapID")?;
    }
    if version >= 69 {
        if version >= 80 {
            if version < 176 {
                v.I32("m_pLeaveSitePointer")?;
            }
            v.I32("m_ulLeaveSiteCnt")?;
            v.I32("m_ulLeaveSiteId")?;
        } else {
            v.Set("m_ulLeaveSiteCnt", 1); // derivado (não está no arquivo)
            v.scope("m_pLeaveSite[0]", |v| L_Task_Region(v, version))?;
            v.I32("m_ulLeaveSiteId")?;
            v.Set("m_pLeaveSite[0].MapID", v.N("m_ulLeaveSiteId")); // derivado (não está no arquivo)
        }
    } else {
    }
    Ok(())
}

fn F35(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 59 {
        if version < 135 {
            v.Bool("m_bFinNeedComp")?;
        }
        v.I32("m_nFinExp1AndOrExp2")?;
        v.scope("m_Fin1KeyValue", |v| L_COMPARE_KEY_VALUE(v, version))?;
        v.scope("m_Fin2KeyValue", |v| L_COMPARE_KEY_VALUE(v, version))?;
    }
    if version >= 178 {
        v.I32("m_nFinPersonExp1AndOrExp2")?;
        v.scope("m_Fin1PersonKeyValue", |v| L_COMPARE_KEY_VALUE(v, version))?;
        v.scope("m_Fin2PersonKeyValue", |v| L_COMPARE_KEY_VALUE(v, version))?;
    }
    if version >= 185 {
        v.I32("m_nFinHistoryExp1AndOrExp2")?;
        v.scope("m_Fin1HistoryKeyValue", |v| L_COMPARE_KEY_VALUE(v, version))?;
        v.scope("m_Fin2HistoryKeyValue", |v| L_COMPARE_KEY_VALUE(v, version))?;
    }
    Ok(())
}

fn F38(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 104 {
        v.U8("m_ucTransformedForm")?;
    }
    if version >= 215 {
        v.U32("m_ulMonsterShapeID")?;
    }
    if version >= 156 && version < 175 {
        v.I32("TransformedDescID")?;
    }
    if version >= 113 {
        v.I32("m_ulReachLevel")?;
        v.I32("m_ulReachReincarnationCount")?;
        v.I32("m_ulReachRealmLevel")?;
        v.I32("m_uiEmotion")?;
    }
    if version >= 153 {
        v.I32("m_ulGrowthTarget")?;
    }
    Ok(())
}

fn F39(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 223 {
        v.U32("m_uSpecialMethodType")?;
        v.U32("m_uSpecialMethodParm1")?;
        v.U32("m_uSpecialMethodParm2")?;
        v.U32("m_uSpecialMethodParm3")?;
        v.U32("m_uSpecialMethodNpcServicesCount")?;
        v.U32("m_uSpecialMethodNpcServicesLeastLeastCount")?;
        v.U32("m_uSpecialMethodTargetTaskCount")?;
        v.U32("m_uSpecialMethodTargetTaskLeastCount")?;
    }
    Ok(())
}

fn F40(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 122 {
        v.I32("m_ulTMIconStateID")?;
    }
    if version >= 156 && version < 175 {
        v.I32("TMIconStateDescID")?;
    }
    if version >= 127 {
        v.I32("m_ulTMHomeLevelType")?;
    }
    if version >= 126 {
        v.I32("m_ulTMReachHomeLevel")?;
        v.I32("m_ulTMReachHomeFlourish")?;
        v.I32("m_ulHomeItemsWanted")?;
        if version < 176 {
            v.I32("m_HomeItemsWantedPointer")?;
        }
    }
    if version >= 135 {
        v.I32("m_ulBindOnCarrierId")?;
        if version >= 140 {
            v.I16("m_ulTMReachArenaCount")?;
        } else {
            v.I32("m_ulTMReachArenaCount")?;
        }
    }
    if version >= 137 {
        if version >= 140 {
            v.I16("m_ulTMReachArenaWinCount")?;
        } else {
            v.I32("m_ulTMReachArenaWinCount")?;
        }
    }
    if version >= 215 {
        v.U32("m_ulTransmitPointID")?;
    }
    if version >= 156 {
        v.Str16("m_szShowDialogName", 20)?;
    }
    if version >= 167 {
        v.I32("m_iTriggerEvent")?;
    }
    if version >= 175 {
        v.I32("m_iVerifyStateLayer")?;
        v.I32("m_ulVerifyStateLayerID")?;
        v.I32("m_iKeyWordIndex")?;
    }
    Ok(())
}

fn F41(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 140 {
        v.Str16("m_TaskEventName", 30)?;
        v.I32("m_TaskEventType")?;
        v.I16("m_usTaskEventTimeOrScore")?;
        v.I16("m_usTaskEventMonsterCount")?;
        if version < 176 {
            v.I32("TaskEventMonsterDataPointer")?;
        }
        v.I16("m_usTaskEventMineCount")?;
        if version < 176 {
            v.I32("TaskEventMineDataPointer")?;
        }
        v.I16("m_usTaskEventTaskCount")?;
        if version < 176 {
            v.I32("TaskEventTaskDataPointer")?;
        }
    }
    if version >= 146 {
        v.I16("m_FactionPersonScore")?;
    }
    if version >= 153 {
        v.U8("m_iTinyGameType")?;
    }
    if version >= 215 {
        v.U8("m_iSlotMachineType")?;
    }
    if version >= 158 {
        v.I32("m_ulGoldWanted2")?;
    }
    if version >= 185 {
        v.I32("m_chatGroupId")?;
    }
    if version >= 219 {
        v.I32("m_HintConfigId")?;
    }
    if version >= 188 {
        v.I32("m_iGuessStringID")?;
    }
    Ok(())
}

fn F42(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 194 {
        v.F32("camera_pos_x")?;
        v.F32("camera_pos_y")?;
        v.F32("camera_pos_z")?;
        v.F32("camera_quat_x")?;
        v.F32("camera_quat_y")?;
        v.F32("camera_quat_z")?;
        v.F32("camera_quat_a")?;
        v.F32("camera_target_pos_x")?;
        v.F32("camera_target_pos_y")?;
        v.F32("camera_target_pos_z")?;
        v.F32("camera_target_quat_x")?;
        v.F32("camera_target_quat_y")?;
        v.F32("camera_target_quat_z")?;
        v.F32("camera_target_quat_a")?;
        v.I32("camera_rotate_axis")?;
        v.F32("camera_rotate_angle")?;
        v.F32("camera_take_seconds")?;
    }
    if version >= 215 {
        v.U32("m_ulSubmitItemWantedNum")?;
    }
    if version >= 228 {
        v.U32("m_ulDailyActivityValue")?;
    }
    Ok(())
}

fn F36(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 63 {
        v.I32("m_ulExpCnt")?;
        if version < 176 {
            v.I32("m_pszExpPointer")?;
            v.I32("m_pExpArrPointer")?;
        }
    }
    if version >= 178 {
        v.I32("m_ulPersonExpCnt")?;
    }
    if version >= 185 {
        v.I32("m_ulHistoryExpCnt")?;
    }
    Ok(())
}

fn F37(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 63 {
        v.I32("m_ulTaskCharCnt")?;
        if version < 176 {
            v.I32("m_pTaskCharPointer")?;
        }
    }
    if version >= 178 {
        v.I32("m_ulPersonTaskCharCnt")?;
    }
    if version >= 185 {
        v.I32("m_ulHistoryTaskCharCnt")?;
    }
    Ok(())
}

fn F43(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulAwardType_S")?;
    v.I32("m_ulAwardType_F")?;
    if version < 176 {
        v.I32("m_Award_SPointer")?;
        v.I32("m_Award_FPointer")?;
        v.I32("m_AwByRatio_SPointer")?;
        v.I32("m_AwByRatio_FPointer")?;
        v.I32("m_AwByItems_SPointer")?;
        v.I32("m_AwByItems_FPointer")?;
        if version >= 140 {
            v.I32("AwByTaskEventRatio_SPointer")?;
            v.I32("AwByTaskEventRatio_FPointer")?;
        }
        if version >= 146 {
            v.I32("AwByCarrierHp_SPointer")?;
            v.I32("AwByCarrierHp_FPointer")?;
        }
        if version >= 161 {
            v.I32("AwByVar_SPointer")?;
            v.I32("AwByVar_FPointer")?;
        }
    }
    v.I32("m_ulParent")?;
    v.I32("m_ulPrevSibling")?;
    v.I32("m_ulNextSibling")?;
    v.I32("m_ulFirstChild")?;
    if version >= 83 {
        if version < 135 {
            v.Bool("m_bIsLibraryTask")?;
        }
        v.F32("m_fLibraryTasksProbability")?;
    }
    if version >= 95 && version < 135 {
        v.Bool("m_bIsUniqueStorageTask")?;
    }
    if version >= 119 {
        v.I32("m_iWorldContribution")?;
    }
    if version >= 215 {
        v.I32("m_iMaskDisableIcon")?;
    }
    Ok(())
}

fn F44(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 135 {
        v.Bytes("CombinedSwitches", GetCombinedSwitches(version))?;
        ApplyCombinedSwitchesParameters(v, version)?;
    }
    Ok(())
}

fn F45(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version == 139 {
        v.Bool("m_bWriteSpecialLog")?;
    }
    if version >= 146 {
        v.I32("x_SpecialParametersCount")?;
        if version < 176 {
            v.I32("SpecialParametersPointer")?;
        }
    }
    if v.N("m_bHasSign") != 0 {
        v.Str16("m_pszSignature", 30)?;
    }
    Ok(())
}

fn F46(v: &mut Schema<'_>, version: i64) -> Result<()> {
    for i in 0..v.limit(v.N("m_ulTimetable"))? {
        v.scope(&format!("m_tmStart[{i}]"), |v| L_task_tm(v, version))?;
        v.scope(&format!("m_tmEnd[{i}]"), |v| L_task_tm(v, version))?;
    }
    Ok(())
}

fn F47(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 59 {
        if version >= 233 {
            for i in 0..v.limit(v.N("m_ulChangeKeyCnt"))? {
                v.scope(&format!("m_pChangeKey[{i}]"), |v| L_CHANGE_KEY(v, version))?;
            }
        } else {
            if version >= 215 {}
            for j in 0..v.limit(v.N("m_ulChangeKeyCnt"))? {
                v.I32(&format!("m_plChangeKey[{j}]"))?;
                v.I32(&format!("m_plChangeKeyValue[{j}]"))?;
                if version >= 215 {
                    v.I32(&format!("m_plChangeKeyValue2[{j}]"))?;
                }
                v.U8(&format!("m_pbChangeType[{j}]"))?;
            }
        }
    }
    if version >= 178 {
        if version >= 233 {
            for k in 0..v.limit(v.N("m_ulChangePersonKeyCnt"))? {
                v.scope(&format!("m_pPersonChangeKey[{k}]"), |v| {
                    L_CHANGE_KEY(v, version)
                })?;
            }
        } else {
            if version >= 215 {}
            for l in 0..v.limit(v.N("m_ulChangePersonKeyCnt"))? {
                v.I32(&format!("m_plPersonChangeKey[{l}]"))?;
                v.I32(&format!("m_plPersonChangeKeyValue[{l}]"))?;
                if version >= 215 {
                    v.I32(&format!("m_plPersonChangeKeyValue2[{l}]"))?;
                }
                v.U8(&format!("m_pbPersonChangeType[{l}]"))?;
            }
        }
    }
    if version < 185 {
        return Ok(());
    }
    if version >= 233 {
        for m in 0..v.limit(v.N("m_ulChangeHistoryKeyCnt"))? {
            v.scope(&format!("m_pHistoryChangeKey[{m}]"), |v| {
                L_CHANGE_KEY(v, version)
            })?;
        }
        return Ok(());
    }
    if version >= 215 {}
    for n in 0..v.limit(v.N("m_ulChangeHistoryKeyCnt"))? {
        v.I32(&format!("m_plHistoryChangeKey[{n}]"))?;
        v.I32(&format!("m_plHistoryChangeKeyValue[{n}]"))?;
        if version >= 215 {
            v.I32(&format!("m_plHistoryChangeKeyValue2[{n}]"))?;
        }
        v.U8(&format!("m_pbHistoryChangeType[{n}]"))?;
    }
    Ok(())
}

fn F48(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 75 {
        for i in 0..v.limit(v.N("m_ulPQExpCnt"))? {
            v.Str8(&format!("m_pszPQExp[{i}]"), 64)?;
            for j in 0..v.limit((64))? {
                v.scope(&format!("m_pPQExpArr[{i}][{j}]"), |v| {
                    L_TASK_EXPRESSION(v, version)
                })?;
            }
        }
        for k in 0..v.limit(v.N("m_ulMonsterContribCnt"))? {
            v.scope(&format!("m_MonstersContrib[{k}]"), |v| {
                L_MONSTERS_CONTRIB(v, version)
            })?;
        }
    }
    if version >= 182 {
        v.Set(
            "PropMonsterSummoned.m_ulMonsterNum",
            v.N("m_ulPropSummonedMonsters"),
        ); // derivado (não está no arquivo)
        v.scope("PropMonsterSummoned", |v| {
            L_AWARD_MONSTERS_SUMMONED3(v, version)
        })?;
    }
    for l in 0..v.limit(v.N("m_ulMonsterContribCnt"))? {}
    Ok(())
}

fn F49(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 80 {
        for i in 0..v.limit(v.N("m_ulDelvRegionCnt"))? {
            v.scope(&format!("m_pDelvRegion[{i}]"), |v| {
                L_Task_Region(v, version)
            })?;
            if version < 157 {
                v.Set(&format!("m_pDelvRegion[{i}].MapID"), v.N("m_ulDelvWorld"));
                // derivado (não está no arquivo)
            }
        }
        for j in 0..v.limit(v.N("m_ulEnterRegionCnt"))? {
            v.scope(&format!("m_pEnterRegion[{j}]"), |v| {
                L_Task_Region(v, version)
            })?;
            if version < 157 {
                v.Set(
                    &format!("m_pEnterRegion[{j}].MapID"),
                    v.N("m_ulEnterRegionWorld"),
                ); // derivado (não está no arquivo)
            }
        }
        for k in 0..v.limit(v.N("m_ulLeaveRegionCnt"))? {
            v.scope(&format!("m_pLeaveRegion[{k}]"), |v| {
                L_Task_Region(v, version)
            })?;
            if version < 157 {
                v.Set(
                    &format!("m_pLeaveRegion[{k}].MapID"),
                    v.N("m_ulLeaveRegionWorld"),
                ); // derivado (não está no arquivo)
            }
        }
    }
    if version >= 215 {
        for l in 0..v.limit(v.N("m_ulVaguePromptNumbers"))? {
            v.scope(&format!("m_pVaguePromptInfo[{l}]"), |v| {
                L_VAGUE_PROMPT_INFO(v, version)
            })?;
        }
    }
    Ok(())
}

fn F50(v: &mut Schema<'_>, version: i64) -> Result<()> {
    for i in 0..v.limit(v.N("m_ulPremItems"))? {
        v.scope(&format!("m_PremItems[{i}]"), |v| L_ITEM_WANTED(v, version))?;
    }
    for j in 0..v.limit(v.N("m_ulGivenItems"))? {
        v.scope(&format!("m_GivenItems[{j}]"), |v| L_ITEM_WANTED(v, version))?;
    }
    for k in 0..v.limit(v.N("m_ulTeamMemsWanted"))? {
        v.scope(&format!("m_TeamMemsWanted[{k}]"), |v| {
            L_TEAM_MEM_WANTED(v, version)
        })?;
    }
    if version >= 109 {
        for l in 0..v.limit(v.N("m_iPremTitleNumTotal"))? {
            v.I32(&format!("m_PremTitles[{l}]"))?;
        }
    }
    if version >= 109 {
        for m in 0..v.limit(v.N("m_iPremTitleNumTotal"))? {}
    }
    Ok(())
}

fn F51(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 195 {
        for i in 0..v.limit(v.N("m_ulMonsterUnwanted"))? {
            v.scope(&format!("m_MonsterUnwanted[{i}]"), |v| {
                L_MONSTER_WANTED(v, version)
            })?;
        }
    }
    for j in 0..v.limit(v.N("m_ulMonsterWanted"))? {
        v.scope(&format!("m_MonsterWanted[{j}]"), |v| {
            L_MONSTER_WANTED(v, version)
        })?;
    }
    if version >= 103 {
        for k in 0..v.limit(v.N("m_ulPlayerWanted"))? {
            v.scope(&format!("m_PlayerWanted[{k}]"), |v| {
                L_PLAYER_WANTED(v, version)
            })?;
        }
    }
    for l in 0..v.limit(v.N("m_ulItemsWanted"))? {
        v.scope(&format!("m_ItemsWanted[{l}]"), |v| {
            L_ITEM_WANTED(v, version)
        })?;
    }
    Ok(())
}

fn F52(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 215 {
        for i in 0..v.limit(v.N("m_ulSubmitItemWantedNum"))? {
            v.scope(&format!("m_pSubmitItemWanted[{i}]"), |v| {
                L_ITEM_WANTED(v, version)
            })?;
        }
    }
    if version >= 223 {
        for j in 0..v.limit(v.N("m_uSpecialMethodNpcServicesCount"))? {
            v.scope(&format!("m_pTSMNPCServices[{j}]"), |v| {
                L_TSMNPCServices(v, version)
            })?;
        }
        for k in 0..v.limit(v.N("m_uSpecialMethodTargetTaskCount"))? {
            v.scope(&format!("m_pTSMTargetTask[{k}]"), |v| {
                L_TSMTargetTask(v, version)
            })?;
        }
    }
    Ok(())
}

fn F53(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 63 {
        for i in 0..v.limit(v.N("m_ulExpCnt"))? {
            v.Str8(&format!("m_pszExp[{i}]"), 64)?;
            for j in 0..v.limit((64))? {
                v.scope(&format!("m_pExpArr[{i}][{j}]"), |v| {
                    L_TASK_EXPRESSION(v, version)
                })?;
            }
        }
        for k in 0..v.limit(v.N("m_ulTaskCharCnt"))? {
            v.Str16(&format!("m_pTaskChar[{k}]"), 64)?;
        }
    }
    if version >= 178 {
        for l in 0..v.limit(v.N("m_ulPersonExpCnt"))? {
            v.Str8(&format!("PersonExp[{l}]"), 64)?;
            for m in 0..v.limit((64))? {
                v.scope(&format!("PersonExpArr[{l}][{m}]"), |v| {
                    L_TASK_EXPRESSION(v, version)
                })?;
            }
        }
        for n in 0..v.limit(v.N("m_ulPersonTaskCharCnt"))? {
            v.Str16(&format!("PersonTaskChar[{n}]"), 64)?;
        }
    }
    if version < 185 {
        return Ok(());
    }
    for num in 0..v.limit(v.N("m_ulHistoryExpCnt"))? {
        v.Str8(&format!("HistoryExp[{num}]"), 64)?;
        for num2 in 0..v.limit((64))? {
            v.scope(&format!("HistoryExpArr[{num}][{num2}]"), |v| {
                L_TASK_EXPRESSION(v, version)
            })?;
        }
    }
    for num3 in 0..v.limit(v.N("m_ulHistoryTaskCharCnt"))? {
        v.Str16(&format!("HistoryTaskChar[{num3}]"), 64)?;
    }
    Ok(())
}

fn F54(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version < 80 {
        return Ok(());
    }
    for i in 0..v.limit(v.N("m_ulReachSiteCnt"))? {
        v.scope(&format!("m_pReachSite[{i}]"), |v| L_Task_Region(v, version))?;
        if version < 157 {
            v.Set(&format!("m_pReachSite[{i}].MapID"), v.N("m_ulReachSiteId")); // derivado (não está no arquivo)
        }
    }
    for j in 0..v.limit(v.N("m_ulLeaveSiteCnt"))? {
        v.scope(&format!("m_pLeaveSite[{j}]"), |v| L_Task_Region(v, version))?;
        if version < 157 {
            v.Set(&format!("m_pLeaveSite[{j}].MapID"), v.N("m_ulLeaveSiteId")); // derivado (não está no arquivo)
        }
    }
    Ok(())
}

fn F55(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 227 {
        for i in 0..v.limit(v.N("m_ulChangeSceneRemoveItemRegionNum"))? {
            v.scope(&format!("m_pChangeSceneRemoveItemRegionNum[{i}]"), |v| {
                L_ITEM_WANTED(v, version)
            })?;
        }
        for j in 0..v.limit(v.N("m_ulChangeSceneRemoveNum"))? {
            v.scope(&format!("m_pChangeSceneRemoveNum[{j}]"), |v| {
                L_Task_Region(v, version)
            })?;
        }
    }
    Ok(())
}

fn F56(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 126 {
        for i in 0..v.limit(v.N("m_ulHomeItemsWanted"))? {
            v.scope(&format!("m_HomeItemsWanted[{i}]"), |v| {
                L_HOME_ITEM_WANTED(v, version)
            })?;
        }
    }
    Ok(())
}

fn F57(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 140 {
        for i in 0..v.limit(v.N("m_usTaskEventMonsterCount"))? {
            v.scope(&format!("TaskEventMonsterData[{i}]"), |v| {
                L_TaskEventData(v, version)
            })?;
        }
        for j in 0..v.limit(v.N("m_usTaskEventMineCount"))? {
            v.scope(&format!("TaskEventMineData[{j}]"), |v| {
                L_TaskEventData(v, version)
            })?;
        }
        for k in 0..v.limit(v.N("m_usTaskEventTaskCount"))? {
            v.scope(&format!("TaskEventTaskData[{k}]"), |v| {
                L_TaskEventData(v, version)
            })?;
        }
    }
    Ok(())
}

fn F58(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.scope("m_Award_S", |v| L_AWARD_DATA(v, version))?;
    v.scope("m_Award_F", |v| L_AWARD_DATA(v, version))?;
    v.scope("m_AwByRatio_S", |v| L_AWARD_RATIO_SCALE(v, version))?;
    v.scope("m_AwByRatio_F", |v| L_AWARD_RATIO_SCALE(v, version))?;
    v.scope("m_AwByItems_S", |v| L_AWARD_ITEMS_SCALE(v, version))?;
    v.scope("m_AwByItems_F", |v| L_AWARD_ITEMS_SCALE(v, version))?;
    if version >= 140 {
        v.scope("AwByTaskEventRatio_S", |v| L_AWARD_RATIO_SCALE(v, version))?;
        v.scope("AwByTaskEventRatio_F", |v| L_AWARD_RATIO_SCALE(v, version))?;
    }
    if version >= 146 {
        v.scope("AwByCarrierHp_S", |v| L_AWARD_CARRIER_HP_SCALE(v, version))?;
        v.scope("AwByCarrierHp_F", |v| L_AWARD_CARRIER_HP_SCALE(v, version))?;
    }
    if version >= 161 {
        v.scope("AwByVar_S", |v| L_AWARD_VAR_SCALE(v, version))?;
        v.scope("AwByVar_F", |v| L_AWARD_VAR_SCALE(v, version))?;
    }
    if version >= 146 {
        {
            let c = v.N("x_SpecialParametersCount");
            v.scope("SpecialParameters", |v| L_SPECIAL_PARAMETERS(v, version, c))?;
        }
    }
    Ok(())
}

fn ApplyCombinedSwitchesParameters(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.Set("m_bShowByTransformed", v.Switch(version, 0)); // bit em CombinedSwitches
    v.Set("m_bShowByLev", v.Switch(version, 1)); // bit em CombinedSwitches
    v.Set("m_bPremCheckReincarnation", v.Switch(version, 2)); // bit em CombinedSwitches
    v.Set("m_bShowByReincarnation", v.Switch(version, 3)); // bit em CombinedSwitches
    v.Set("m_bPremCheckRealmLevel", v.Switch(version, 4)); // bit em CombinedSwitches
    v.Set("m_bPremCheckRealmExpFull", v.Switch(version, 5)); // bit em CombinedSwitches
    if version >= 232 {
        v.Set("m_bCheckTradeTime", v.Switch(version, 6)); // bit em CombinedSwitches
        v.Set("m_bShowByTradeTime", v.Switch(version, 7)); // bit em CombinedSwitches
    }
    v.Set("m_bShowByRealmLevel", v.Switch(version, 8)); // bit em CombinedSwitches
    v.Set("m_bShowByItems", v.Switch(version, 9)); // bit em CombinedSwitches
    v.Set("m_bPremItemsAnyOne", v.Switch(version, 10)); // bit em CombinedSwitches
    if version >= 215 {
        v.Set("m_bMethodItemsRandOne", v.Switch(version, 11)); // bit em CombinedSwitches
    }
    v.Set("m_bNotOpenWithItem", v.Switch(version, 12)); // bit em CombinedSwitches
    v.Set("m_bShowByDeposit", v.Switch(version, 13)); // bit em CombinedSwitches
    v.Set("m_bShowByRepu", v.Switch(version, 14)); // bit em CombinedSwitches
    v.Set("m_bShowByPreTask", v.Switch(version, 15)); // bit em CombinedSwitches
    v.Set("m_bShowByPeriod", v.Switch(version, 16)); // bit em CombinedSwitches
    v.Set("m_bShowByFaction", v.Switch(version, 17)); // bit em CombinedSwitches
    v.Set("m_bShowByGender", v.Switch(version, 18)); // bit em CombinedSwitches
    v.Set("m_bShowByOccup", v.Switch(version, 19)); // bit em CombinedSwitches
    v.Set("m_bPremise_Spouse", v.Switch(version, 20)); // bit em CombinedSwitches
    v.Set("m_bShowBySpouse", v.Switch(version, 21)); // bit em CombinedSwitches
    v.Set("m_bPremiseWeddingOwner", v.Switch(version, 22)); // bit em CombinedSwitches
    v.Set("m_bShowByWeddingOwner", v.Switch(version, 23)); // bit em CombinedSwitches
    v.Set("m_bGM", v.Switch(version, 24)); // bit em CombinedSwitches
    v.Set("m_bShieldUser", v.Switch(version, 25)); // bit em CombinedSwitches
    v.Set("m_bShowByRMB", v.Switch(version, 26)); // bit em CombinedSwitches
    v.Set("m_bCharTime", v.Switch(version, 27)); // bit em CombinedSwitches
    v.Set("m_bShowByCharTime", v.Switch(version, 28)); // bit em CombinedSwitches
    v.Set("m_bTeamwork", v.Switch(version, 29)); // bit em CombinedSwitches
    v.Set("m_bRcvByTeam", v.Switch(version, 30)); // bit em CombinedSwitches
    v.Set("m_bSharedTask", v.Switch(version, 31)); // bit em CombinedSwitches
    v.Set("m_bSharedAchieved", v.Switch(version, 32)); // bit em CombinedSwitches
    v.Set("m_bCheckTeammate", v.Switch(version, 33)); // bit em CombinedSwitches
    v.Set("m_bAllFail", v.Switch(version, 34)); // bit em CombinedSwitches
    v.Set("m_bCapFail", v.Switch(version, 35)); // bit em CombinedSwitches
    v.Set("m_bCapSucc", v.Switch(version, 36)); // bit em CombinedSwitches
    v.Set("m_bDismAsSelfFail", v.Switch(version, 37)); // bit em CombinedSwitches
    v.Set("m_bRcvChckMem", v.Switch(version, 38)); // bit em CombinedSwitches
    v.Set("m_bCntByMemPos", v.Switch(version, 39)); // bit em CombinedSwitches
    v.Set("m_bAllSucc", v.Switch(version, 40)); // bit em CombinedSwitches
    v.Set("m_bCoupleOnly", v.Switch(version, 41)); // bit em CombinedSwitches
    v.Set("m_bDistinguishedOcc", v.Switch(version, 42)); // bit em CombinedSwitches
    v.Set("m_bShowByTeam", v.Switch(version, 43)); // bit em CombinedSwitches
    v.Set("m_bPremNeedComp", v.Switch(version, 44)); // bit em CombinedSwitches
    if version >= 178 {
        v.Set("m_bPremHistoryNeedComp", v.Switch(version, 45)); // bit em CombinedSwitches
    }
    if version >= 185 {
        v.Set("m_bPremNeedCompHistory", v.Switch(version, 46)); // bit em CombinedSwitches
    }
    v.Set("m_bPremCheckForce", v.Switch(version, 47)); // bit em CombinedSwitches
    v.Set("m_bShowByForce", v.Switch(version, 48)); // bit em CombinedSwitches
    v.Set("m_bShowByForceReputation", v.Switch(version, 49)); // bit em CombinedSwitches
    v.Set("m_bShowByForceContribution", v.Switch(version, 50)); // bit em CombinedSwitches
    v.Set("m_bShowByForceExp", v.Switch(version, 51)); // bit em CombinedSwitches
    v.Set("m_bShowByForceSP", v.Switch(version, 52)); // bit em CombinedSwitches
    v.Set("m_bShowByForceActivityLevel", v.Switch(version, 53)); // bit em CombinedSwitches
    v.Set("m_bPremIsKing", v.Switch(version, 54)); // bit em CombinedSwitches
    v.Set("m_bShowByKing", v.Switch(version, 55)); // bit em CombinedSwitches
    v.Set("m_bPremNotInTeam", v.Switch(version, 56)); // bit em CombinedSwitches
    v.Set("m_bShowByNotInTeam", v.Switch(version, 57)); // bit em CombinedSwitches
    v.Set("m_bShowByTitle", v.Switch(version, 58)); // bit em CombinedSwitches
    v.Set("m_bShowByHistoryStage", v.Switch(version, 59)); // bit em CombinedSwitches
    v.Set("m_bShowByGeneralCard", v.Switch(version, 60)); // bit em CombinedSwitches
    v.Set("m_bShowByGeneralCardRank", v.Switch(version, 61)); // bit em CombinedSwitches
    v.Set("m_bShowByIconStateID", v.Switch(version, 62)); // bit em CombinedSwitches
    v.Set("m_bShowByVIPLevel", v.Switch(version, 63)); // bit em CombinedSwitches
    v.Set("m_bPremNoHome", v.Switch(version, 64)); // bit em CombinedSwitches
    v.Set("m_bShowByHomeLevel", v.Switch(version, 65)); // bit em CombinedSwitches
    v.Set("m_bShowByHomeResourceLevel", v.Switch(version, 66)); // bit em CombinedSwitches
    v.Set("m_bShowByHomeFactoryLevel", v.Switch(version, 67)); // bit em CombinedSwitches
    v.Set("m_bShowByHomeFlourish", v.Switch(version, 68)); // bit em CombinedSwitches
    v.Set("m_bPremHomeStorageTask", v.Switch(version, 69)); // bit em CombinedSwitches
    v.Set("m_bShowByHomeStorageTask", v.Switch(version, 70)); // bit em CombinedSwitches
    v.Set("m_bMonsterTotalCount", v.Switch(version, 71)); // bit em CombinedSwitches
    if version >= 195 {
        v.Set("m_bDoNotShowGfx", v.Switch(version, 72)); // bit em CombinedSwitches
    }
    v.Set("m_bFinNeedComp", v.Switch(version, 73)); // bit em CombinedSwitches
    if version >= 178 {
        v.Set("m_bFinPersonNeedComp", v.Switch(version, 74)); // bit em CombinedSwitches
    }
    if version >= 185 {
        v.Set("m_bFinHistoryNeedComp", v.Switch(version, 75)); // bit em CombinedSwitches
    }
    v.Set("m_bIsLibraryTask", v.Switch(version, 76)); // bit em CombinedSwitches
    v.Set("m_bIsUniqueStorageTask", v.Switch(version, 77)); // bit em CombinedSwitches
    v.Set("m_bHasSign", v.Switch(version, 78)); // bit em CombinedSwitches
    v.Set("m_bOfflineFail", v.Switch(version, 79)); // bit em CombinedSwitches
    v.Set("m_bItemNotTakeOff", v.Switch(version, 80)); // bit em CombinedSwitches
    v.Set("m_bAbsTime", v.Switch(version, 81)); // bit em CombinedSwitches
    if version >= 180 {
        v.Set("m_bMultiNpcTalk", v.Switch(version, 82)); // bit em CombinedSwitches
    }
    v.Set("m_bChooseOne", v.Switch(version, 83)); // bit em CombinedSwitches
    v.Set("m_bRandOne", v.Switch(version, 84)); // bit em CombinedSwitches
    v.Set("m_bExeChildInOrder", v.Switch(version, 85)); // bit em CombinedSwitches
    v.Set("m_bParentAlsoFail", v.Switch(version, 86)); // bit em CombinedSwitches
    v.Set("m_bParentAlsoSucc", v.Switch(version, 87)); // bit em CombinedSwitches
    v.Set("m_bCanGiveUp", v.Switch(version, 88)); // bit em CombinedSwitches
    v.Set("m_bCanRedo", v.Switch(version, 89)); // bit em CombinedSwitches
    v.Set("m_bCanRedoAfterFailure", v.Switch(version, 90)); // bit em CombinedSwitches
    v.Set("m_bClearAsGiveUp", v.Switch(version, 91)); // bit em CombinedSwitches
    v.Set("m_bNeedRecord", v.Switch(version, 92)); // bit em CombinedSwitches
    v.Set("m_bFailAsPlayerDie", v.Switch(version, 93)); // bit em CombinedSwitches
    v.Set("m_bDelvInZone", v.Switch(version, 94)); // bit em CombinedSwitches
    v.Set("m_bEnterRegionFail", v.Switch(version, 95)); // bit em CombinedSwitches
    v.Set("m_bLeaveRegionFail", v.Switch(version, 96)); // bit em CombinedSwitches
    v.Set("m_bLeaveForceFail", v.Switch(version, 97)); // bit em CombinedSwitches
    v.Set("m_bTransTo", v.Switch(version, 98)); // bit em CombinedSwitches
    v.Set("m_bTrigCtrl", v.Switch(version, 99)); // bit em CombinedSwitches
    v.Set("m_bAutoDeliver", v.Switch(version, 100)); // bit em CombinedSwitches
    if version >= 240 {
        v.Set("m_bAutoDeliverHighPriority", v.Switch(version, 101)); // bit em CombinedSwitches
    }
    v.Set("m_bDisplayInExclusiveUI", v.Switch(version, 102)); // bit em CombinedSwitches
    v.Set("m_bReadyToNotifyServer", v.Switch(version, 103)); // bit em CombinedSwitches
    v.Set("m_bUsedInTokenShop", v.Switch(version, 104)); // bit em CombinedSwitches
    v.Set("m_bDeathTrig", v.Switch(version, 105)); // bit em CombinedSwitches
    v.Set("m_bClearAcquired", v.Switch(version, 106)); // bit em CombinedSwitches
    v.Set("m_bShowPrompt", v.Switch(version, 107)); // bit em CombinedSwitches
    v.Set("m_bKeyTask", v.Switch(version, 108)); // bit em CombinedSwitches
    v.Set("m_bSkillTask", v.Switch(version, 109)); // bit em CombinedSwitches
    v.Set("m_bCanSeekOut", v.Switch(version, 110)); // bit em CombinedSwitches
    v.Set("m_bShowDirection", v.Switch(version, 111)); // bit em CombinedSwitches
    v.Set("m_bMarriage", v.Switch(version, 112)); // bit em CombinedSwitches
    v.Set("m_bSwitchSceneFail", v.Switch(version, 113)); // bit em CombinedSwitches
    v.Set("m_bHidden", v.Switch(version, 114)); // bit em CombinedSwitches
    v.Set("m_bDeliverySkill", v.Switch(version, 115)); // bit em CombinedSwitches
    v.Set("m_bShowGfxFinished", v.Switch(version, 116)); // bit em CombinedSwitches
    v.Set("m_bChangePQRanking", v.Switch(version, 117)); // bit em CombinedSwitches
    v.Set("m_bCompareItemAndInventory", v.Switch(version, 118)); // bit em CombinedSwitches
    v.Set("m_bTowerTask", v.Switch(version, 119)); // bit em CombinedSwitches
    v.Set("m_bHomeTask", v.Switch(version, 120)); // bit em CombinedSwitches
    v.Set("m_bDeliverInHostHome", v.Switch(version, 121)); // bit em CombinedSwitches
    v.Set("m_bFinishInHostHome", v.Switch(version, 122)); // bit em CombinedSwitches
    v.Set("m_bPQTask", v.Switch(version, 123)); // bit em CombinedSwitches
    v.Set("m_bPQSubTask", v.Switch(version, 124)); // bit em CombinedSwitches
    v.Set("m_bClearContrib", v.Switch(version, 125)); // bit em CombinedSwitches
    v.Set("m_bShowByNeedRecordTasksNum", v.Switch(version, 126)); // bit em CombinedSwitches
    v.Set("m_bShowByFactionContrib", v.Switch(version, 127)); // bit em CombinedSwitches
    v.Set("m_bAccountTaskLimit", v.Switch(version, 128)); // bit em CombinedSwitches
    v.Set("m_bRoleTaskLimit", v.Switch(version, 129)); // bit em CombinedSwitches
    v.Set("m_bLeaveFactionFail", v.Switch(version, 130)); // bit em CombinedSwitches
    v.Set("m_bNotIncCntWhenFailed", v.Switch(version, 131)); // bit em CombinedSwitches
    v.Set("m_bNotClearItemWhenFailed", v.Switch(version, 132)); // bit em CombinedSwitches
    v.Set("m_bDisplayInTitleTaskUI", v.Switch(version, 133)); // bit em CombinedSwitches
    v.Set("m_bCanAwardOnCarrier", v.Switch(version, 134)); // bit em CombinedSwitches
    if version >= 137 {
        v.Set("m_bPremReachArenaWinCount", v.Switch(version, 135)); // bit em CombinedSwitches
        v.Set("m_bShowByReachArenaWinCount", v.Switch(version, 136)); // bit em CombinedSwitches
    }
    if version >= 140 {
        v.Set("m_bWriteSpecialLog", v.Switch(version, 137)); // bit em CombinedSwitches
    }
    if version >= 146 {
        v.Set("m_bShowByFactionScore", v.Switch(version, 138)); // bit em CombinedSwitches
        v.Set("m_bShowByFactionMoney", v.Switch(version, 139)); // bit em CombinedSwitches
        v.Set("m_bShowByFactionPersonScore", v.Switch(version, 140)); // bit em CombinedSwitches
        v.Set("m_bCheckFactionMember", v.Switch(version, 141)); // bit em CombinedSwitches
        v.Set("m_bPremFaction", v.Switch(version, 142)); // bit em CombinedSwitches
        v.Set("m_bSpecialLogic", v.Switch(version, 143)); // bit em CombinedSwitches
    }
    if version >= 153 {
        v.Set("m_bBecomeMentor", v.Switch(version, 144)); // bit em CombinedSwitches
        v.Set("m_bShowMentorMorality", v.Switch(version, 145)); // bit em CombinedSwitches
        v.Set("m_bShowMentorStudentValue", v.Switch(version, 146)); // bit em CombinedSwitches
        v.Set("m_bDiscardedTask", v.Switch(version, 147)); // bit em CombinedSwitches
        v.Set("m_bNoCheckTitleGot", v.Switch(version, 148)); // bit em CombinedSwitches
    }
    if version >= 156 {
        v.Set("m_bShowCoupleIntimacy", v.Switch(version, 149)); // bit em CombinedSwitches
    }
    if version >= 158 {
        v.Set("m_bShowDeposit2", v.Switch(version, 150)); // bit em CombinedSwitches
    }
    if version >= 194 {
        v.Set("m_bCrossServer", v.Switch(version, 151)); // bit em CombinedSwitches
    }
    if version >= 163 {
        v.Set("m_bRecordFnshCnt", v.Switch(version, 152)); // bit em CombinedSwitches
    }
    if version >= 198 {
        v.Set("m_bRecordReset", v.Switch(version, 153)); // bit em CombinedSwitches
    }
    if version >= 167 {
        v.Set("m_bShowCamp", v.Switch(version, 154)); // bit em CombinedSwitches
        v.Set("m_bShowCampPower", v.Switch(version, 155)); // bit em CombinedSwitches
        v.Set("m_bReturnCampPower", v.Switch(version, 156)); // bit em CombinedSwitches
        v.Set("m_bTeamHaveRecaller", v.Switch(version, 157)); // bit em CombinedSwitches
        v.Set("m_bBindedRecaller", v.Switch(version, 158)); // bit em CombinedSwitches
        v.Set("m_bShowNeedFriendPoint", v.Switch(version, 159)); // bit em CombinedSwitches
    }
    if version >= 175 {
        v.Set("m_bHistoryVarTask", v.Switch(version, 160)); // bit em CombinedSwitches
        v.Set("m_bRankPre", v.Switch(version, 161)); // bit em CombinedSwitches
        v.Set("m_bDeliverByUI", v.Switch(version, 162)); // bit em CombinedSwitches
    }
    if version >= 177 {
        v.Set("m_bWarTaskAward", v.Switch(version, 163)); // bit em CombinedSwitches
    }
    if version >= 180 {
        v.Set("m_bHideOtherPlayer", v.Switch(version, 164)); // bit em CombinedSwitches
    }
    if version >= 187 {
        v.Set("m_bRecordDeliverTime", v.Switch(version, 165)); // bit em CombinedSwitches
    }
    if version >= 194 {
        v.Set("m_bShowMethod", v.Switch(version, 166)); // bit em CombinedSwitches
    }
    if version >= 198 {
        v.Set("m_bPremCheckPanguLevel", v.Switch(version, 167)); // bit em CombinedSwitches
        v.Set("m_bShowAchievementSeriesId", v.Switch(version, 168)); // bit em CombinedSwitches
        v.Set("m_bVaguePromptingMode", v.Switch(version, 169)); // bit em CombinedSwitches
    }
    if version >= 215 {
        v.Set("m_bCheckPanguEquip", v.Switch(version, 170)); // bit em CombinedSwitches
        v.Set("m_bShowPanguEquipPremise", v.Switch(version, 171)); // bit em CombinedSwitches
        v.Set("m_bShowExploreIcon", v.Switch(version, 172)); // bit em CombinedSwitches
    }
    if version >= 234 {
        v.Set("m_bShowByExpNotFull", v.Switch(version, 173)); // bit em CombinedSwitches
    }
    if version >= 218 {
        v.Set("m_bCheckInventorySize", v.Switch(version, 174)); // bit em CombinedSwitches
        v.Set("m_bCheckStorageSize", v.Switch(version, 175)); // bit em CombinedSwitches
        v.Set("m_bShowPackSizePremise", v.Switch(version, 176)); // bit em CombinedSwitches
    }
    if version >= 234 {
        v.Set("m_bShowByRealmExpNotFull", v.Switch(version, 177)); // bit em CombinedSwitches
        v.Set("m_bAllowBatchAward", v.Switch(version, 178)); // bit em CombinedSwitches
    }
    if version >= 223 {
        v.Set("m_bCheckExp", v.Switch(version, 179)); // bit em CombinedSwitches
        v.Set("m_bCheckRealmExp", v.Switch(version, 180)); // bit em CombinedSwitches
        v.Set("m_bShowPropertyPremis", v.Switch(version, 181)); // bit em CombinedSwitches
        v.Set("m_bCheckLieMoLevel", v.Switch(version, 182)); // bit em CombinedSwitches
        v.Set("m_bCheckYuMoLevel", v.Switch(version, 183)); // bit em CombinedSwitches
    }
    if version >= 229 {
        v.Set("m_bShowDailyActivityPremise", v.Switch(version, 184)); // bit em CombinedSwitches
    }
    if version >= 236 {
        v.Set("m_bFailIconStateID", v.Switch(version, 185)); // bit em CombinedSwitches
    }
    if version >= 238 {
        v.Set("m_bPremTotalItemsWanted", v.Switch(version, 186)); // bit em CombinedSwitches
        v.Set("m_bMethodTotalItemsWanted", v.Switch(version, 187)); // bit em CombinedSwitches
    }
    Ok(())
}

fn L_AWARD_CARRIER_HP_SCALE(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulScales")?;
    for i in 0..v.limit((5))? {
        v.I32(&format!("AwardCarrierHp[{i}]"))?;
    }
    for j in 0..v.limit((v.N("m_ulScales")))? {
        v.scope(&format!("m_Awards[{j}]"), |v| L_AWARD_DATA(v, version))?;
    }
    Ok(())
}

fn L_AWARD_DATA(v: &mut Schema<'_>, version: i64) -> Result<()> {
    A_ReadBasicProperties(v, version)?;
    A_ReadStorageProperties(v, version)?;
    A_ReadControlProperties(v, version)?;
    A_ReadItemsAndMonsters(v, version)?;
    A_ReadSkillAndContributions(v, version)?;
    A_ReadChangeKeys(v, version)?;
    A_ReadDisplayAndExpressions(v, version)?;
    A_ReadForceAndTitles(v, version)?;
    A_ReadHomeAndFaction(v, version)?;
    A_ReadAdvancedFeatures(v, version)?;
    A_ReadArrayData(v, version)?;
    Ok(())
}

fn A_ReadBasicProperties(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulGoldNum")?;
    v.I32("m_ulExp")?;
    if version >= 113 {
        v.I32("m_ulRealmExp")?;
        if version >= 198 {
            v.U32("m_ulPanguExp")?;
        }
        if version >= 225 {
            v.U32("m_ulPanguExpYear")?;
        }
        v.Bool("m_bExpandRealmLevelMax")?;
    }
    if version >= 153 {
        v.I32("NewTaskSpace")?;
    }
    v.I32("m_ulNewTask")?;
    v.I32("m_ulSP")?;
    v.I32("m_lReputation")?;
    v.I32("m_ulNewPeriod")?;
    v.I32("m_ulNewRelayStation")?;
    Ok(())
}

fn A_ReadStorageProperties(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulStorehouseSize")?;
    if version >= 57 {
        v.I32("m_ulStorehouseSize2")?;
        v.I32("m_ulStorehouseSize3")?;
    }
    if version >= 75 {
        v.I32("m_ulStorehouseSize4")?;
    }
    if version >= 52 {
        v.I32("m_lInventorySize")?;
        v.I32("m_ulPetInventorySize")?;
    }
    Ok(())
}

fn A_ReadControlProperties(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulFuryULimit")?;
    v.I32("m_ulTransWldId")?;
    if version >= 161 {
        v.I32("m_ulCrossServerWldId")?;
    }
    v.scope("m_TransPt", |v| L_ZONE_VERT(v, version))?;
    if version >= 52 {
        v.I32("m_lMonsCtrl")?;
        v.Bool("m_bTrigCtrl")?;
    }
    if version >= 54 {
        v.Bool("m_bUseLevCo")?;
    }
    if version >= 55 {
        v.Bool("m_bDivorce")?;
    }
    if version >= 56 {
        v.Bool("m_bSendMsg")?;
        v.I32("m_nMsgChannel")?;
    }
    Ok(())
}

fn A_ReadItemsAndMonsters(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulCandItems")?;
    if version < 176 {
        v.I32("m_CandItemsPointer")?;
    }
    if version >= 64 {
        v.I32("m_ulSummonedMonsters")?;
        if version < 176 {
            v.I32("m_MonstersPointer")?;
        }
    }
    if version >= 69 {
        v.Bool("m_bAwardDeath")?;
        v.Bool("m_bAwardDeathWithLoss")?;
    }
    Ok(())
}

fn A_ReadSkillAndContributions(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 75 {
        v.I32("m_ulDividend")?;
    }
    if version >= 225 {
        v.U8("m_bRepairShentongSearchBug")?;
    }
    if version >= 78 {
        v.Bool("m_bAwardSkill")?;
        v.I32("m_iAwardSkillID")?;
        v.I32("m_iAwardSkillLevel")?;
    }
    if version >= 124 {
        v.I32("m_iSoloTowerChallengeScore")?;
    }
    if version >= 153 {
        v.I32("m_iOpenSystem")?;
    }
    if version >= 75 {
        v.I32("m_ulSpecifyContribTaskID")?;
    }
    if version >= 78 {
        v.I32("m_ulSpecifyContribSubTaskID")?;
    }
    if version >= 75 {
        v.I32("m_ulSpecifyContrib")?;
        v.I32("m_ulContrib")?;
        v.I32("m_ulRandContrib")?;
        v.I32("m_ulLowestcontrib")?;
    }
    if version >= 87 {
        v.I32("m_iFactionContrib")?;
    }
    if version >= 89 {
        v.I32("m_iFactionExpContrib")?;
    }
    Ok(())
}

fn A_ReadChangeKeys(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 75 {
        v.I32("m_ulPQRankingAwardCnt")?;
        if version < 176 {
            v.I32("m_RankingAwardPointer")?;
        }
    }
    if version >= 59 {
        v.I32("m_ulChangeKeyCnt")?;
        if version < 176 {
            v.I32("m_ulChangeKeyPointer")?;
            v.I32("m_plChangeKeyValuePointer")?;
            v.I32("m_pbChangeTypePointer")?;
        }
    }
    if version >= 178 {
        v.I32("m_ulPersonChangeKeyCnt")?;
    }
    if version >= 186 {
        v.I32("m_ulCarrierChangeCnt")?;
    }
    if version >= 112 {
        v.I32("m_ulHistoryChangeCnt")?;
        if version < 176 {
            v.I32("m_plHistoryChangeKeyPointer")?;
            v.I32("m_plHistoryChangeKeyValuePointer")?;
            v.I32("m_pbHistoryChangeTypePointer")?;
        }
    }
    Ok(())
}

fn A_ReadDisplayAndExpressions(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 59 {
        v.Bool("m_bMulti")?;
        v.I32("m_nNumType")?;
        v.I32("m_lNum")?;
        v.I32("m_ulDisplayKeyCnt")?;
        if version < 176 {
            v.I32("m_ulDisplayKeyCntPointer")?;
        }
    }
    if version >= 63 {
        v.I32("m_ulExpCnt")?;
        if version < 176 {
            v.I32("m_pszExpPointer")?;
            v.I32("m_pExpArrPointer")?;
        }
        v.I32("m_ulTaskCharCnt")?;
        if version < 176 {
            v.I32("m_pTaskCharPointer")?;
        }
    }
    Ok(())
}

fn A_ReadForceAndTitles(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 97 {
        v.I32("m_iForceContribution")?;
        v.I32("m_iForceReputation")?;
        v.I32("m_iForceActivity")?;
    }
    if version >= 100 {
        v.I32("m_iForceSetRepu")?;
    }
    if version >= 101 {
        v.I32("m_iTaskLimit")?;
    }
    if version >= 109 {
        v.I32("m_ulTitleNum")?;
        if version < 176 {
            v.I32("m_pTitleAwardPointer")?;
        }
    }
    if version >= 115 {
        v.I32("m_iLeaderShip")?;
    }
    if version >= 119 {
        v.I32("m_iWorldContribution")?;
    }
    Ok(())
}

fn A_ReadHomeAndFaction(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 126 {
        for i in 0..v.limit((5))? {
            v.I32(&format!("m_iHomeResource[{i}]"))?;
        }
        v.Bool("m_bCreateHome")?;
    }
    if version >= 135 {
        v.Bool("m_bLeaveCarrier")?;
    }
    if version >= 146 {
        v.I32("m_faction_money")?;
        v.I32("m_faction_person_score")?;
        v.I32("m_usFactionTargetCount")?;
        if version < 176 {
            v.I32("AwardFactionTargetDataPointer")?;
        }
        v.Bool("m_bSubmitRankScore")?;
        v.scope("submit_rank", |v| L_SUBMIT_RANK_INFO(v, version))?;
    }
    if version >= 156 {
        v.I32("m_iMentorStudentValue")?;
        v.I32("m_iCoupleIntimacy")?;
    }
    Ok(())
}

fn A_ReadAdvancedFeatures(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 162 {
        v.I32("m_ulRedBookExp")?;
    }
    if version >= 167 {
        v.I32("m_iCampScore")?;
        v.I32("m_iCrossServerMoney")?;
        v.I32("m_iInviterAwardItem")?;
        v.I32("m_iRewardFriendPoint")?;
    }
    if version >= 175 {
        v.I32("m_iInviterAwardNum")?;
    }
    if version >= 180 {
        v.I32("m_iPerceptionVal")?;
    }
    if version >= 194 {
        v.I32("m_uiGroupNum")?;
        v.I32("m_uiNumPerGroup")?;
    }
    if version >= 216 {
        v.I32("m_iNewPlayerEvent")?;
    }
    if version >= 232 {
        v.I32("m_iFactionAwardConfig")?;
    }
    if version >= 237 {
        v.Bool("m_iAwardRedBookKey")?;
        v.I32("m_iAwardRedBookKeyType")?;
        v.I32("m_iAwardRedBookKeyCount")?;
    }
    if version >= 240 {
        v.I32("m_iAwardCameraMovementID")?;
    }
    Ok(())
}

fn A_ReadArrayData(v: &mut Schema<'_>, version: i64) -> Result<()> {
    A_ReadCandidateItems(v, version)?;
    A_ReadSummonedMonsters(v, version)?;
    A_ReadRankingAwards(v, version)?;
    A_ReadTitleAwards(v, version)?;
    A_ReadChangeKeyArrays(v, version)?;
    A_ReadDisplayKeys(v, version)?;
    A_ReadExpressionArrays(v, version)?;
    A_ReadTaskCharacters(v, version)?;
    A_ReadFactionTargetData(v, version)?;
    A_ReadRandomDialogGroupData(v, version)?;
    Ok(())
}

fn A_ReadCandidateItems(v: &mut Schema<'_>, version: i64) -> Result<()> {
    for i in 0..v.limit(v.N("m_ulCandItems"))? {
        v.scope(&format!("m_CandItems[{i}]"), |v| {
            L_AWARD_ITEMS_CAND(v, version)
        })?;
    }
    Ok(())
}

fn A_ReadSummonedMonsters(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 64 && v.N("m_ulSummonedMonsters") > 0 {
        v.Set(
            "m_SummonedMonsters.m_ulMonsterNum",
            v.N("m_ulSummonedMonsters"),
        ); // derivado (não está no arquivo)
        v.scope("m_SummonedMonsters", |v| {
            L_AWARD_MONSTERS_SUMMONED(v, version)
        })?;
    }
    Ok(())
}

fn A_ReadRankingAwards(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 75 && v.N("m_ulPQRankingAwardCnt") > 0 {
        v.Set(
            "m_PQRankingAward.m_ulRankingAwardNum",
            v.N("m_ulPQRankingAwardCnt"),
        ); // derivado (não está no arquivo)
        v.scope("m_PQRankingAward", |v| L_AWARD_PQ_RANKING(v, version))?;
    }
    Ok(())
}

fn A_ReadTitleAwards(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 109 {
        for i in 0..v.limit(v.N("m_ulTitleNum"))? {
            v.scope(&format!("m_pTitleAward[{i}]"), |v| {
                L_TITLE_AWARD(v, version)
            })?;
        }
    }
    Ok(())
}

fn A_ReadChangeKeyArrays(v: &mut Schema<'_>, version: i64) -> Result<()> {
    A_ReadMainChangeKeys(v, version)?;
    A_ReadPersonChangeKeys(v, version)?;
    A_ReadNewChangeKeys(v, version)?;
    A_ReadHistoryChangeKeys(v, version)?;
    Ok(())
}

fn A_ReadMainChangeKeys(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version < 59 {
        return Ok(());
    }
    if version >= 215 {}
    for i in 0..v.limit(v.N("m_ulChangeKeyCnt"))? {
        v.I32(&format!("m_plChangeKey[{i}]"))?;
        v.I32(&format!("m_plChangeKeyValue[{i}]"))?;
        if version >= 215 {
            v.I32(&format!("m_plChangeKeyValue2[{i}]"))?;
        }
        v.U8(&format!("m_pbChangeType[{i}]"))?;
    }
    Ok(())
}

fn A_ReadPersonChangeKeys(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version < 178 {
        return Ok(());
    }
    if version >= 215 {}
    for i in 0..v.limit(v.N("m_ulPersonChangeKeyCnt"))? {
        v.I32(&format!("PersonChangeKey[{i}]"))?;
        v.I32(&format!("PersonChangeKeyValue[{i}]"))?;
        if version >= 215 {
            v.I32(&format!("PersonChangeKeyValue2[{i}]"))?;
        }
        v.U8(&format!("PersonChangeType[{i}]"))?;
    }
    Ok(())
}

fn A_ReadNewChangeKeys(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version < 186 {
        return Ok(());
    }
    if version >= 215 {}
    for i in 0..v.limit(v.N("m_ulCarrierChangeCnt"))? {
        v.I32(&format!("NewChangeKey[{i}]"))?;
        v.I32(&format!("NewChangeKeyValue[{i}]"))?;
        if version >= 215 {
            v.I32(&format!("NewChangeKeyValue2[{i}]"))?;
        }
        v.U8(&format!("NewChangeType[{i}]"))?;
    }
    Ok(())
}

fn A_ReadHistoryChangeKeys(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version < 112 {
        return Ok(());
    }
    if version >= 215 {}
    for i in 0..v.limit(v.N("m_ulHistoryChangeCnt"))? {
        v.I32(&format!("m_plHistoryChangeKey[{i}]"))?;
        v.I32(&format!("m_plHistoryChangeKeyValue[{i}]"))?;
        if version >= 215 {
            v.I32(&format!("m_plHistoryChangeKeyValue2[{i}]"))?;
        }
        v.U8(&format!("m_pbHistoryChangeType[{i}]"))?;
    }
    Ok(())
}

fn A_ReadDisplayKeys(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 59 {
        for i in 0..v.limit(v.N("m_ulDisplayKeyCnt"))? {
            v.I32(&format!("m_plDisplayKey[{i}]"))?;
        }
    }
    Ok(())
}

fn A_ReadExpressionArrays(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version < 63 {
        return Ok(());
    }
    for i in 0..v.limit(v.N("m_ulExpCnt"))? {
        v.Str8(&format!("m_pszExp[{i}]"), 64)?;
        for j in 0..v.limit((64))? {
            v.scope(&format!("m_pExpArr[{i}][{j}]"), |v| {
                L_TASK_EXPRESSION(v, version)
            })?;
        }
    }
    Ok(())
}

fn A_ReadTaskCharacters(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 63 {
        for i in 0..v.limit(v.N("m_ulTaskCharCnt"))? {
            v.Str16(&format!("m_pTaskChar[{i}]"), 64)?;
        }
    }
    Ok(())
}

fn A_ReadFactionTargetData(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 146 {
        for i in 0..v.limit(v.N("m_usFactionTargetCount"))? {
            v.scope(&format!("AwardFactionTargetData[{i}]"), |v| {
                L_FACTION_TARGET_DATA(v, version)
            })?;
        }
    }
    Ok(())
}

fn A_ReadRandomDialogGroupData(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 194 && v.N("m_uiGroupNum") > 0 && v.N("m_uiNumPerGroup") > 0 {
        {
            let g = v.N("m_uiGroupNum");
            let k = v.N("m_uiNumPerGroup");
            v.scope("AwardRandomDialogGroupData", |v| {
                L_RANDOM_DIALOG_GROUP_DATA(v, version, g, k)
            })?;
        }
    }
    Ok(())
}

fn L_AWARD_ITEMS_CAND(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.Bool("m_bRandChoose")?;
    v.I32("m_ulAwardItems")?;
    for i in 0..v.limit(v.N("m_ulAwardItems"))? {
        v.scope(&format!("m_AwardItems[{i}]"), |v| L_ITEM_WANTED(v, version))?;
    }
    Ok(())
}

fn L_AWARD_ITEMS_SCALE(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulScales")?;
    v.I32("m_ulItemId")?;
    let maxAwardScales = GetMaxAwardScales(version);
    for i in 0..v.limit(maxAwardScales)? {
        v.I32(&format!("m_Counts[{i}]"))?;
    }
    for j in 0..v.limit(v.N("m_ulScales"))? {
        v.scope(&format!("m_Awards[{j}]"), |v| L_AWARD_DATA(v, version))?;
    }
    Ok(())
}

fn L_AWARD_MONSTERS_SUMMONED(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.Bool("m_bRandChoose")?;
    v.I32("m_ulSummonRadius")?;
    v.Bool("m_bDeathDisappear")?;
    for i in 0..v.limit(v.N("m_ulMonsterNum"))? {
        v.scope(&format!("m_Monsters[{i}]"), |v| {
            L_MONSTERS_SUMMONED(v, version)
        })?;
    }
    Ok(())
}

fn L_AWARD_MONSTERS_SUMMONED2(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 180 {
        v.I32("m_ulMonsterNum")?;
        v.Bool("m_bRandChoose")?;
        v.I32("m_ulSummonRadius")?;
        v.Bool("m_bDeathDisappear")?;
    }
    for i in 0..v.limit(32)? {
        if version >= 180 {
            v.scope(&format!("m_Monsters[{i}]"), |v| {
                L_MONSTERS_SUMMONED(v, version)
            })?;
        }
    }
    Ok(())
}

fn L_AWARD_MONSTERS_SUMMONED3(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if v.N("m_ulMonsterNum") > 0 {
        v.I32("m_ulMonsterNum")?;
        v.Bool("m_bRandChoose")?;
        v.I32("m_ulSummonRadius")?;
        v.Bool("m_bDeathDisappear")?;
    }
    for i in 0..v.limit(32)? {
        if i < v.N("m_ulMonsterNum") {
            v.scope(&format!("m_Monsters[{i}]"), |v| {
                L_MONSTERS_SUMMONED(v, version)
            })?;
        }
    }
    Ok(())
}

fn L_AWARD_PQ_RANKING(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.Bool("m_bAwardByProf")?;
    for i in 0..v.limit(v.N("m_ulRankingAwardNum"))? {
        v.scope(&format!("m_RankingAward[{i}]"), |v| {
            L_RANKING_AWARD(v, version)
        })?;
    }
    Ok(())
}

fn L_AWARD_RATIO_SCALE(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulScales")?;
    let maxAwardScales = GetMaxAwardScales(version);
    for i in 0..v.limit(maxAwardScales)? {
        v.F32(&format!("m_Ratios[{i}]"))?;
    }
    for j in 0..v.limit(v.N("m_ulScales"))? {
        v.scope(&format!("m_Awards[{j}]"), |v| L_AWARD_DATA(v, version))?;
    }
    Ok(())
}

fn L_AWARD_VAR_SCALE(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulScales")?;
    for i in 0..v.limit((16))? {
        v.scope(&format!("AwardVar[{i}]"), |v| L_TASK_EXPRESSION(v, version))?;
    }
    for j in 0..v.limit((v.N("m_ulScales")))? {
        v.scope(&format!("m_Awards[{j}]"), |v| L_AWARD_DATA(v, version))?;
    }
    Ok(())
}

fn L_CHANGE_KEY(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("key")?;
    v.I32("value")?;
    if version >= 215 {
        v.I32("value2")?;
    }
    v.U8("type")?;
    Ok(())
}

fn L_COMPARE_KEY_VALUE(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("nLeftType")?;
    v.I32("lLeftNum")?;
    v.I32("nCompOper")?;
    v.I32("nRightType")?;
    v.I32("lRightNum")?;
    Ok(())
}

fn L_FACTION_TARGET_DATA(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("FactionTargetId")?;
    v.I32("FactionNum")?;
    Ok(())
}

fn L_HOME_ITEM_WANTED(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulHomeItemTid")?;
    v.I32("m_ulHomeItemCount")?;
    Ok(())
}

fn L_ITEM_WANTED(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulItemTemplId")?;
    v.Bool("m_bCommonItem")?;
    v.I32("m_ulItemNum")?;
    v.F32("m_fProb")?;
    if version >= 60 {
        v.I32("m_lPeriod")?;
    }
    if version >= 234 {
        v.U32("m_ulServerLimit")?;
    }
    Ok(())
}

fn L_Kill_Player_Requirements(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulOccupations")?;
    v.I32("m_iMinLevel")?;
    v.I32("m_iMaxLevel")?;
    v.I32("m_iGender")?;
    v.I32("m_iForce")?;
    if version >= 130 {
        v.Bool("ModelCheck")?;
        for i in 0..v.limit(3)? {
            v.U8(&format!("ModelType[{i}]"))?;
        }
    }
    Ok(())
}

fn L_MONSTERS_CONTRIB(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulMonsterTemplId")?;
    v.I32("m_iWholeContrib")?;
    v.I32("m_iShareContrib")?;
    if version >= 82 {
        v.I32("m_iPersonalWholeContrib")?;
    }
    Ok(())
}

fn L_MONSTERS_SUMMONED(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulMonsterTemplId")?;
    v.I32("m_ulMonsterNum")?;
    v.F32("m_fSummonProb")?;
    v.I32("m_lPeriod")?;
    Ok(())
}

fn L_MONSTER_WANTED(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulMonsterTemplId")?;
    v.I32("m_ulMonsterNum")?;
    v.I32("m_ulDropItemId")?;
    v.I32("m_ulDropItemCount")?;
    v.Bool("m_bDropCmnItem")?;
    v.F32("m_fDropProb")?;
    v.U8("m_bKillerLev")?;
    if version >= 92 {
        v.I32("m_iDPH")?;
        v.I32("m_iDPS")?;
    }
    if version >= 226 {
        v.I32("m_iWorldLevel")?;
    }
    Ok(())
}

fn L_PLAYER_WANTED(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulPlayerNum")?;
    v.I32("m_ulDropItemId")?;
    v.I32("m_ulDropItemCount")?;
    v.Bool("m_bDropCmnItem")?;
    v.F32("m_fDropProb")?;
    v.scope("m_Requirements", |v| L_Kill_Player_Requirements(v, version))?;
    Ok(())
}

fn L_RANKING_AWARD(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_iRankingStart")?;
    v.I32("m_iRankingEnd")?;
    v.Bool("m_bCommonItem")?;
    v.I32("m_ulAwardItemId")?;
    v.I32("m_ulAwardItemNum")?;
    v.I32("m_lPeriod")?;
    Ok(())
}

fn L_SUBMIT_RANK_INFO(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_iSubmitType")?;
    v.I32("m_iRankID")?;
    v.I32("m_iTempRankID")?;
    Ok(())
}

fn L_TASK_EXPRESSION(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("type")?;
    v.I32("value")?;
    Ok(())
}

fn L_TEAM_MEM_WANTED(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulLevelMin")?;
    v.I32("m_ulLevelMax")?;
    v.I32("m_ulRace")?;
    v.I32("m_ulOccupation")?;
    v.I32("m_ulGender")?;
    v.I32("m_ulMinCount")?;
    v.I32("m_ulMaxCount")?;
    v.I32("m_ulTask")?;
    if version >= 97 {
        v.I32("m_iForce")?;
    }
    if version >= 153 {
        v.I16("TeamMemTaskSpace")?;
    }
    Ok(())
}

fn L_TITLE_AWARD(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("m_ulTitleID")?;
    v.I32("m_lPeriod")?;
    if version >= 234 {
        v.U32("m_ulServerLimit")?;
    }
    Ok(())
}

fn L_TSMNPCServices(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.U32("service1")?;
    v.U32("service2")?;
    v.U32("service3")?;
    v.U32("service4")?;
    Ok(())
}

fn L_TSMTargetTask(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.U32("target1")?;
    v.U32("target2")?;
    Ok(())
}

fn L_TaskEventData(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 153 {
        v.I16("IdSpace")?;
    }
    v.I32("Id")?;
    v.F32("Value")?;
    Ok(())
}

fn L_Task_Region(v: &mut Schema<'_>, version: i64) -> Result<()> {
    if version >= 157 {
        v.I32("MapID")?;
    }
    if version >= 191 {
        v.I32("RegionID")?;
    }
    v.scope("zvMin", |v| L_ZONE_VERT(v, version))?;
    v.scope("zvMax", |v| L_ZONE_VERT(v, version))?;
    Ok(())
}

fn L_VAGUE_PROMPT_INFO(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.F32("m_fVaguePromptRadius")?;
    v.F32("m_fVaguePromptX")?;
    v.F32("m_fVaguePromptY")?;
    Ok(())
}

fn L_ZONE_VERT(v: &mut Schema<'_>, version: i64) -> Result<()> {
    for i in 0..v.limit(3)? {
        v.F32(&format!("v[{i}]"))?;
    }
    Ok(())
}

fn L_task_tm(v: &mut Schema<'_>, version: i64) -> Result<()> {
    v.I32("year")?;
    v.I32("month")?;
    v.I32("day")?;
    v.I32("hour")?;
    v.I32("min")?;
    v.I32("wday")?;
    Ok(())
}

/// <summary>Chaves de quest que viram bits em CombinedSwitches (v135+): nome, versão mínima, máxima (0 = sem limite).</summary>

pub(super) const SWITCHES: &[(&str, i64, i64)] = &[
    ("ShowByTransformed", 0, 0),
    ("ShowByLev", 0, 0),
    ("PremCheckReincarnation", 0, 0),
    ("ShowByReincarnation", 0, 0),
    ("PremCheckRealmLevel", 0, 0),
    ("PremCheckRealmExpFull", 0, 0),
    ("CheckTradeTime", 232, 0),
    ("ShowByTradeTime", 232, 0),
    ("ShowByRealmLevel", 0, 0),
    ("ShowByItems", 0, 0),
    ("PremItemsAnyOne", 0, 0),
    ("MethodItemsRandOne", 215, 0),
    ("NotOpenWithItem", 0, 0),
    ("ShowByDeposit", 0, 0),
    ("ShowByRepu", 0, 0),
    ("ShowByPreTask", 0, 0),
    ("ShowByPeriod", 0, 0),
    ("ShowByFaction", 0, 0),
    ("ShowByGender", 0, 0),
    ("ShowByOccup", 0, 0),
    ("Premise_Spouse", 0, 0),
    ("ShowBySpouse", 0, 0),
    ("PremiseWeddingOwner", 0, 0),
    ("ShowByWeddingOwner", 0, 0),
    ("GM", 0, 0),
    ("ShieldUser", 0, 0),
    ("ShowByRMB", 0, 0),
    ("CharTime", 0, 0),
    ("ShowByCharTime", 0, 0),
    ("Teamwork", 0, 0),
    ("RcvByTeam", 0, 0),
    ("SharedTask", 0, 0),
    ("SharedAchieved", 0, 0),
    ("CheckTeammate", 0, 0),
    ("AllFail", 0, 0),
    ("CapFail", 0, 0),
    ("CapSucc", 0, 0),
    ("DismAsSelfFail", 0, 0),
    ("RcvChckMem", 0, 0),
    ("CntByMemPos", 0, 0),
    ("AllSucc", 0, 0),
    ("CoupleOnly", 0, 0),
    ("DistinguishedOcc", 0, 0),
    ("ShowByTeam", 0, 0),
    ("PremNeedComp", 0, 0),
    ("PremNeedCompPerson", 178, 0),
    ("PremNeedCompHistory", 185, 0),
    ("PremCheckForce", 0, 0),
    ("ShowByForce", 0, 0),
    ("ShowByForceReputation", 0, 0),
    ("ShowByForceContribution", 0, 0),
    ("ShowByForceExp", 0, 0),
    ("ShowByForceSP", 0, 0),
    ("ShowByForceActivityLevel", 0, 0),
    ("PremIsKing", 0, 0),
    ("ShowByKing", 0, 0),
    ("PremNotInTeam", 0, 0),
    ("ShowByNotInTeam", 0, 0),
    ("ShowByTitle", 0, 0),
    ("ShowByHistoryStage", 0, 0),
    ("ShowByGeneralCard", 0, 0),
    ("ShowByGeneralCardRank", 0, 0),
    ("ShowByIconStateID", 0, 0),
    ("ShowByVIPLevel", 0, 0),
    ("PremNoHome", 0, 0),
    ("ShowByHomeLevel", 0, 0),
    ("ShowByHomeResourceLevel", 0, 0),
    ("ShowByHomeFactoryLevel", 0, 0),
    ("ShowByHomeFlourish", 0, 0),
    ("PremHomeStorageTask", 0, 0),
    ("ShowByHomeStorageTask", 0, 0),
    ("MonsterTotalCount", 0, 0),
    ("NotShowGfx", 195, 0),
    ("FinNeedComp", 0, 0),
    ("FinNeedCompPerson", 178, 0),
    ("FinNeedCompHistory", 185, 0),
    ("IsLibraryTask", 0, 0),
    ("IsUniqueStorageTask", 0, 0),
    ("HasSign", 0, 0),
    ("OfflineFail", 0, 0),
    ("ItemNotTakeOff", 0, 0),
    ("AbsTime", 0, 0),
    ("MultiNpcTalk", 180, 0),
    ("ChooseOne", 0, 0),
    ("RandOne", 0, 0),
    ("ExeChildInOrder", 0, 0),
    ("ParentAlsoFail", 0, 0),
    ("ParentAlsoSucc", 0, 0),
    ("CanGiveUp", 0, 0),
    ("CanRedo", 0, 0),
    ("CanRedoAfterFailure", 0, 0),
    ("ClearAsGiveUp", 0, 0),
    ("NeedRecord", 0, 0),
    ("FailAsPlayerDie", 0, 0),
    ("DelvInZone", 0, 0),
    ("EnterRegionFail", 0, 0),
    ("LeaveRegionFail", 0, 0),
    ("LeaveForceFail", 0, 0),
    ("TransTo", 0, 0),
    ("TrigCtrl", 0, 0),
    ("AutoDeliver", 0, 0),
    ("DisplayInExclusiveUI", 0, 0),
    ("ReadyToNotifyServer", 0, 0),
    ("UsedInTokenShop", 0, 0),
    ("DeathTrig", 0, 0),
    ("ClearAcquired", 0, 0),
    ("ShowPrompt", 0, 0),
    ("KeyTask", 0, 0),
    ("SkillTask", 0, 0),
    ("CanSeekOut", 0, 0),
    ("ShowDirection", 0, 0),
    ("Marriage", 0, 0),
    ("SwitchSceneFail", 0, 0),
    ("Hidden", 0, 0),
    ("DeliverySkill", 0, 0),
    ("ShowGfxFinished", 0, 0),
    ("ChangePQRanking", 0, 0),
    ("CompareItemAndInventory", 0, 0),
    ("TowerTask", 0, 0),
    ("HomeTask", 0, 0),
    ("DeliverInHostHome", 0, 0),
    ("FinishInHostHome", 0, 0),
    ("PQTask", 0, 0),
    ("PQSubTask", 0, 0),
    ("ClearContrib", 0, 0),
    ("ShowByNeedRecordTasksNum", 0, 0),
    ("ShowByFactionContrib", 0, 0),
    ("AccountTaskLimit", 0, 0),
    ("RoleTaskLimit", 0, 0),
    ("LeaveFactionFail", 0, 0),
    ("NotIncCntWhenFailed", 0, 0),
    ("NotClearItemWhenFailed", 0, 0),
    ("DisplayInTitleTaskUI", 0, 0),
    ("CanAwardOnCarrier", 0, 0),
    ("PreReachArenaWinCount", 0, 0),
    ("ShowByReachArenaWinCount", 0, 0),
    ("WriteSpecialLog", 0, 0),
    ("ShowByPreFactionScore", 0, 0),
    ("ShowByPreFactionMoney", 0, 0),
    ("ShowByPreFactionPersonScore", 0, 0),
    ("CheckFactionMem", 0, 0),
    ("ByFactionScore", 0, 0),
    ("SpecailLogicTask", 0, 0),
    ("BecomeMentor", 0, 0),
    ("ShowMentorMorality", 0, 0),
    ("ShowMentorStudent", 0, 0),
    ("DiscardedTask", 0, 0),
    ("NoCheckTitleGot", 0, 0),
    ("ShowCoupleIntimacy", 0, 0),
    ("ShowByDeposit2", 0, 0),
    ("CrossServer", 194, 0),
    ("RecordFinishCount", 0, 0),
    ("RecordReset", 198, 0),
    ("ShowCamp", 0, 0),
    ("ShowCampPower", 0, 0),
    ("ReturnCampPower", 0, 0),
    ("TeamHaveRecaller", 0, 0),
    ("BindedRecaller", 0, 0),
    ("ShowNeedFriendPoint", 0, 0),
    ("HistoryVarTask", 0, 0),
    ("PremRank", 0, 0),
    ("DeliverByUI", 0, 0),
    ("WarTaskAward", 0, 0),
    ("HideOtherPlayer", 0, 0),
    ("RecordDeliverTime", 0, 0),
    ("ShowMethod", 194, 0),
    ("CheckPanguLevel", 198, 0),
    ("AchievementSeriesId", 198, 0),
    ("VaguePromptingMode", 198, 0),
    ("CheckPanguEquip", 215, 0),
    ("ShowPanguEquipPremise", 215, 0),
    ("ShowExploreIcon", 215, 0),
    ("ShowByExpNotFull", 234, 0),
    ("CheckInventorySize", 218, 0),
    ("CheckStorageSize", 218, 0),
    ("ShowPackSizePremise", 218, 0),
    ("ShowByRealmExpNotFull", 234, 0),
    ("AllowBatchAward", 234, 0),
    ("CheckExp", 223, 0),
    ("CheckRealmExp", 223, 0),
    ("ShowPropertyPremis", 223, 0),
    ("CheckLieMoLevel", 223, 0),
    ("CheckYuMoLevel", 223, 0),
    ("ShowDailyActivityPremise", 229, 0),
    ("FailIconStateID", 236, 0),
];

/// <summary>Nomes das chaves na ordem do enum (o número usado em v.Switch).</summary>
pub(super) const SWITCH_PARAMS: &[&str] = &[
    "ShowByTransformed",
    "ShowByLev",
    "PremCheckReincarnation",
    "ShowByReincarnation",
    "PremCheckRealmLevel",
    "PremCheckRealmExpFull",
    "CheckTradeTime",
    "ShowByTradeTime",
    "ShowByRealmLevel",
    "ShowByItems",
    "PremItemsAnyOne",
    "MethodItemsRandOne",
    "NotOpenWithItem",
    "ShowByDeposit",
    "ShowByRepu",
    "ShowByPreTask",
    "ShowByPeriod",
    "ShowByFaction",
    "ShowByGender",
    "ShowByOccup",
    "Premise_Spouse",
    "ShowBySpouse",
    "PremiseWeddingOwner",
    "ShowByWeddingOwner",
    "GM",
    "ShieldUser",
    "ShowByRMB",
    "CharTime",
    "ShowByCharTime",
    "Teamwork",
    "RcvByTeam",
    "SharedTask",
    "SharedAchieved",
    "CheckTeammate",
    "AllFail",
    "CapFail",
    "CapSucc",
    "DismAsSelfFail",
    "RcvChckMem",
    "CntByMemPos",
    "AllSucc",
    "CoupleOnly",
    "DistinguishedOcc",
    "ShowByTeam",
    "PremNeedComp",
    "PremNeedCompPerson",
    "PremNeedCompHistory",
    "PremCheckForce",
    "ShowByForce",
    "ShowByForceReputation",
    "ShowByForceContribution",
    "ShowByForceExp",
    "ShowByForceSP",
    "ShowByForceActivityLevel",
    "PremIsKing",
    "ShowByKing",
    "PremNotInTeam",
    "ShowByNotInTeam",
    "ShowByTitle",
    "ShowByHistoryStage",
    "ShowByGeneralCard",
    "ShowByGeneralCardRank",
    "ShowByIconStateID",
    "ShowByVIPLevel",
    "PremNoHome",
    "ShowByHomeLevel",
    "ShowByHomeResourceLevel",
    "ShowByHomeFactoryLevel",
    "ShowByHomeFlourish",
    "PremHomeStorageTask",
    "ShowByHomeStorageTask",
    "MonsterTotalCount",
    "NotShowGfx",
    "FinNeedComp",
    "FinNeedCompPerson",
    "FinNeedCompHistory",
    "IsLibraryTask",
    "IsUniqueStorageTask",
    "HasSign",
    "OfflineFail",
    "ItemNotTakeOff",
    "AbsTime",
    "MultiNpcTalk",
    "ChooseOne",
    "RandOne",
    "ExeChildInOrder",
    "ParentAlsoFail",
    "ParentAlsoSucc",
    "CanGiveUp",
    "CanRedo",
    "CanRedoAfterFailure",
    "ClearAsGiveUp",
    "NeedRecord",
    "FailAsPlayerDie",
    "DelvInZone",
    "EnterRegionFail",
    "LeaveRegionFail",
    "LeaveForceFail",
    "TransTo",
    "TrigCtrl",
    "AutoDeliver",
    "AutoDeliverHighPriority",
    "DisplayInExclusiveUI",
    "ReadyToNotifyServer",
    "UsedInTokenShop",
    "DeathTrig",
    "ClearAcquired",
    "ShowPrompt",
    "KeyTask",
    "SkillTask",
    "CanSeekOut",
    "ShowDirection",
    "Marriage",
    "SwitchSceneFail",
    "Hidden",
    "DeliverySkill",
    "ShowGfxFinished",
    "ChangePQRanking",
    "CompareItemAndInventory",
    "TowerTask",
    "HomeTask",
    "DeliverInHostHome",
    "FinishInHostHome",
    "PQTask",
    "PQSubTask",
    "ClearContrib",
    "ShowByNeedRecordTasksNum",
    "ShowByFactionContrib",
    "AccountTaskLimit",
    "RoleTaskLimit",
    "LeaveFactionFail",
    "NotIncCntWhenFailed",
    "NotClearItemWhenFailed",
    "DisplayInTitleTaskUI",
    "CanAwardOnCarrier",
    "PreReachArenaWinCount",
    "ShowByReachArenaWinCount",
    "WriteSpecialLog",
    "ShowByPreFactionScore",
    "ShowByPreFactionMoney",
    "ShowByPreFactionPersonScore",
    "CheckFactionMem",
    "ByFactionScore",
    "SpecailLogicTask",
    "BecomeMentor",
    "ShowMentorMorality",
    "ShowMentorStudent",
    "DiscardedTask",
    "NoCheckTitleGot",
    "ShowCoupleIntimacy",
    "ShowByDeposit2",
    "CrossServer",
    "RecordFinishCount",
    "RecordReset",
    "ShowCamp",
    "ShowCampPower",
    "ReturnCampPower",
    "TeamHaveRecaller",
    "BindedRecaller",
    "ShowNeedFriendPoint",
    "HistoryVarTask",
    "PremRank",
    "DeliverByUI",
    "WarTaskAward",
    "HideOtherPlayer",
    "RecordDeliverTime",
    "ShowMethod",
    "CheckPanguLevel",
    "AchievementSeriesId",
    "VaguePromptingMode",
    "CheckPanguEquip",
    "ShowPanguEquipPremise",
    "ShowExploreIcon",
    "ShowByExpNotFull",
    "CheckInventorySize",
    "CheckStorageSize",
    "ShowPackSizePremise",
    "ShowByRealmExpNotFull",
    "AllowBatchAward",
    "CheckExp",
    "CheckRealmExp",
    "ShowPropertyPremis",
    "CheckLieMoLevel",
    "CheckYuMoLevel",
    "ShowDailyActivityPremise",
    "FailIconStateID",
    "PremTotalItemsWanted",
    "MethodTotalItemsWanted",
];
