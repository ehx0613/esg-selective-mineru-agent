from __future__ import annotations

from typing import Any, Dict, List


A_SHARE_SCHEMA_VERSION = "core_esg_v5_a_share_60"


def _field(
    field_key: str,
    name_cn: str,
    category: str,
    topic: str,
    indicator_type: str,
    value_type: str,
    *,
    unit_type: str = "",
    unit_examples: List[str] | None = None,
    aliases: List[str] | None = None,
    search_terms: List[str] | None = None,
    domain_knowledge: str = "",
    expected_units: List[str] | None = None,
    required_any: List[str] | None = None,
    forbidden_any: List[str] | None = None,
    preferred_source: str = "main_text_rag",
    evidence_required: str = "text",
    review_priority: str = "medium",
    unit_required: bool = False,
    year_required: bool = False,
) -> Dict[str, Any]:
    terms = [name_cn, *(aliases or []), *(search_terms or [])]
    units = expected_units if expected_units is not None else unit_examples
    return {
        "field_key": field_key,
        "name_cn": name_cn,
        "category": category,
        "topic": topic,
        "indicator_type": indicator_type,
        "value_type": value_type,
        "unit_type": unit_type,
        "unit_examples": unit_examples or [],
        "expected_units": units or [],
        "aliases": aliases or [],
        "search_terms": search_terms or [],
        "domain_knowledge": domain_knowledge,
        "required_any": required_any if required_any is not None else terms[:8],
        "forbidden_any": forbidden_any or [],
        "preferred_source": preferred_source,
        "evidence_required": evidence_required,
        "review_priority": review_priority,
        "unit_required": unit_required,
        "year_required": year_required,
    }


def _q(
    field_key: str,
    name_cn: str,
    category: str,
    topic: str,
    *,
    unit_type: str,
    unit_examples: List[str],
    aliases: List[str] | None = None,
    search_terms: List[str] | None = None,
    domain_knowledge: str = "",
    required_any: List[str] | None = None,
    forbidden_any: List[str] | None = None,
    review_priority: str = "high",
) -> Dict[str, Any]:
    return _field(
        field_key,
        name_cn,
        category,
        topic,
        "quantitative",
        "number",
        unit_type=unit_type,
        unit_examples=unit_examples,
        aliases=aliases,
        search_terms=search_terms,
        domain_knowledge=domain_knowledge,
        required_any=required_any,
        forbidden_any=forbidden_any,
        preferred_source="appendix_table",
        evidence_required="value_unit_year_source",
        review_priority=review_priority,
        unit_required=True,
        year_required=True,
    )


def _ql(
    field_key: str,
    name_cn: str,
    category: str,
    topic: str,
    *,
    aliases: List[str] | None = None,
    search_terms: List[str] | None = None,
    domain_knowledge: str = "",
    review_priority: str = "medium",
) -> Dict[str, Any]:
    return _field(
        field_key,
        name_cn,
        category,
        topic,
        "qualitative",
        "text",
        aliases=aliases,
        search_terms=search_terms,
        domain_knowledge=domain_knowledge,
        preferred_source="main_text_rag",
        evidence_required="policy_measure_or_case",
        review_priority=review_priority,
    )


def _hy(
    field_key: str,
    name_cn: str,
    category: str,
    topic: str,
    *,
    unit_type: str = "",
    unit_examples: List[str] | None = None,
    aliases: List[str] | None = None,
    search_terms: List[str] | None = None,
    domain_knowledge: str = "",
    review_priority: str = "high",
) -> Dict[str, Any]:
    return _field(
        field_key,
        name_cn,
        category,
        topic,
        "hybrid",
        "mixed",
        unit_type=unit_type,
        unit_examples=unit_examples or [],
        aliases=aliases,
        search_terms=search_terms,
        domain_knowledge=domain_knowledge,
        preferred_source="mixed",
        evidence_required="text_or_value_with_source",
        review_priority=review_priority,
    )


A_SHARE_SCHEMA_DATA: List[Dict[str, Any]] = [
    _ql("climate_governance", "气候变化治理机制", "E", "应对气候变化", aliases=["气候治理", "气候变化管理"], search_terms=["董事会监督气候", "气候变化治理架构"], domain_knowledge="关注公司是否建立董事会或管理层层面的气候变化治理职责。"),
    _ql("climate_risk_opportunity", "气候相关风险与机遇", "E", "应对气候变化", aliases=["气候风险", "气候机遇"], search_terms=["实体风险", "转型风险", "气候相关机遇"], domain_knowledge="关注公司识别的实体风险、转型风险及相关机遇。"),
    _ql("climate_strategy_targets", "气候战略与减排目标", "E", "应对气候变化", aliases=["减排目标", "双碳目标", "碳中和目标"], search_terms=["碳达峰", "碳中和", "减排路线图"], domain_knowledge="关注公司披露的气候战略、减排目标、时间表和进展。"),
    _q("ghg_emissions_total", "温室气体排放总量", "E", "应对气候变化", unit_type="ghg", unit_examples=["吨二氧化碳当量", "tCO2e"], aliases=["碳排放总量", "温室气体排放合计"], forbidden_any=["范围一", "范围二", "Scope 1", "Scope 2", "强度"]),
    _q("ghg_scope1_emissions", "范围一温室气体排放", "E", "应对气候变化", unit_type="ghg", unit_examples=["吨二氧化碳当量", "tCO2e"], aliases=["直接温室气体排放", "Scope 1排放"], required_any=["范围一", "Scope 1", "直接温室气体"]),
    _q("ghg_scope2_emissions", "范围二温室气体排放", "E", "应对气候变化", unit_type="ghg", unit_examples=["吨二氧化碳当量", "tCO2e"], aliases=["间接温室气体排放", "Scope 2排放"], required_any=["范围二", "Scope 2", "间接温室气体"]),
    _q("ghg_emission_intensity", "温室气体排放强度", "E", "应对气候变化", unit_type="intensity", unit_examples=["吨二氧化碳当量/万元", "tCO2e/百万元"], aliases=["碳排放强度", "温室气体排放密度"], required_any=["强度", "密度", "单位收入", "单位产值"], forbidden_any=["总量"]),
    _ql("carbon_reduction_measures", "节能降碳措施", "E", "应对气候变化", aliases=["减碳措施", "节能减排措施"], search_terms=["节能改造", "低碳运营", "碳减排项目"]),
    _q("energy_consumption_total", "综合能源消耗量", "E", "资源利用", unit_type="energy", unit_examples=["吨标准煤", "兆瓦时", "MWh"], aliases=["能源消耗总量", "综合能耗"], forbidden_any=["强度", "密度"]),
    _q("electricity_consumption", "用电量", "E", "资源利用", unit_type="energy", unit_examples=["千瓦时", "兆瓦时", "kWh", "MWh"], aliases=["耗电量", "外购电力", "电力消耗"]),
    _hy("renewable_energy_use", "可再生能源使用", "E", "资源利用", unit_type="energy", unit_examples=["千瓦时", "%"], aliases=["绿电", "绿色电力", "可再生能源"], domain_knowledge="可披露使用量、使用比例、采购绿证或绿电项目。"),
    _q("water_consumption_total", "用水量", "E", "资源利用", unit_type="water", unit_examples=["吨", "立方米"], aliases=["取水量", "耗水量", "新鲜水用量"], forbidden_any=["废水", "回用水", "循环水"]),
    _ql("water_efficiency_measures", "节水与水资源管理", "E", "资源利用", aliases=["节水措施", "水资源管理"], search_terms=["循环用水", "中水回用", "节水项目"]),
    _hy("pollutant_emissions", "污染物排放", "E", "污染防治", unit_type="mass", unit_examples=["吨", "千克"], aliases=["废气排放", "废水排放", "大气污染物", "水污染物"]),
    _q("hazardous_waste", "有害废弃物", "E", "废弃物处理", unit_type="waste", unit_examples=["吨", "千克"], aliases=["危险废弃物", "危废产生量", "有害废弃物产生量"]),
    _q("non_hazardous_waste", "一般废弃物", "E", "废弃物处理", unit_type="waste", unit_examples=["吨", "千克"], aliases=["无害废弃物", "一般固体废弃物", "非危废"], forbidden_any=["危险废弃物", "危废"]),
    _hy("waste_recycling", "废弃物回收利用", "E", "废弃物处理", unit_type="waste", unit_examples=["吨", "%"], aliases=["回收利用", "资源化利用", "循环利用"]),
    _q("packaging_materials", "包装材料使用", "E", "资源利用", unit_type="mass", unit_examples=["吨", "千克"], aliases=["包装物", "包装材料消耗量"]),
    _ql("environmental_compliance", "环境合规管理", "E", "污染防治", aliases=["环境管理体系", "环保合规", "排污许可"], search_terms=["ISO 14001", "环境风险管控"]),
    _hy("environmental_penalties", "环境处罚", "E", "污染防治", unit_type="count_money", unit_examples=["次", "万元"], aliases=["环保处罚", "环境行政处罚", "环境违法违规"]),
    _ql("biodiversity_protection", "生态系统与生物多样性保护", "E", "生态系统和生物多样性保护", aliases=["生物多样性", "生态保护"], search_terms=["生态修复", "自然保护", "栖息地保护"]),
    _ql("circular_economy", "循环经济与资源综合利用", "E", "循环经济", aliases=["循环经济", "资源综合利用"], search_terms=["再利用", "再制造", "循环利用体系"]),
    _q("employee_total", "员工总数", "S", "员工", unit_type="people", unit_examples=["人"], aliases=["员工人数", "雇员总数", "在职员工"]),
    _q("employee_gender_structure", "员工性别结构", "S", "员工", unit_type="people_ratio", unit_examples=["人", "%"], aliases=["男性员工", "女性员工", "按性别划分员工"]),
    _q("employee_age_structure", "员工年龄结构", "S", "员工", unit_type="people_ratio", unit_examples=["人", "%"], aliases=["按年龄划分员工", "年龄结构"]),
    _q("employee_education_structure", "员工学历结构", "S", "员工", unit_type="people_ratio", unit_examples=["人", "%"], aliases=["学历结构", "教育程度"]),
    _q("employee_turnover", "员工流失率", "S", "员工", unit_type="ratio", unit_examples=["%"], aliases=["雇员流失率", "员工离职率"]),
    _ql("labor_employment_compliance", "劳动雇佣合规", "S", "员工", aliases=["劳动合同", "合法雇佣", "禁止童工", "禁止强迫劳动"]),
    _ql("compensation_benefits", "薪酬福利保障", "S", "员工", aliases=["薪酬福利", "员工福利", "社会保险", "住房公积金"]),
    _ql("occupational_health_safety", "职业健康与安全管理", "S", "员工", aliases=["职业健康安全", "安全生产管理", "EHS管理"]),
    _q("work_injury_incidents", "工伤事故", "S", "员工", unit_type="count", unit_examples=["起", "人次"], aliases=["工伤", "工伤事故数", "因工受伤"]),
    _q("work_related_fatalities", "因工死亡人数", "S", "员工", unit_type="people", unit_examples=["人"], aliases=["因工死亡", "工作相关死亡", "工亡"]),
    _hy("safety_training", "安全生产培训", "S", "员工", unit_type="people_hours", unit_examples=["人次", "小时"], aliases=["安全培训", "职业健康安全培训"]),
    _q("employee_training_coverage", "员工培训覆盖率", "S", "员工", unit_type="ratio", unit_examples=["%"], aliases=["培训覆盖率", "受训员工比例"]),
    _q("employee_training_hours", "员工培训小时", "S", "员工", unit_type="hours", unit_examples=["小时", "人均小时"], aliases=["培训总时长", "人均培训小时"]),
    _ql("employee_development", "员工发展与晋升", "S", "员工", aliases=["职业发展", "晋升通道", "人才培养"]),
    _ql("diversity_equal_opportunity", "多元化与平等机会", "S", "员工", aliases=["平等机会", "反歧视", "多元化"]),
    _ql("product_quality", "产品质量管理", "S", "产品和服务", aliases=["质量管理", "产品安全", "质量控制"]),
    _ql("customer_service", "客户服务管理", "S", "产品和服务", aliases=["客户服务", "消费者权益", "客户满意度"]),
    _hy("customer_complaints", "客户投诉处理", "S", "产品和服务", unit_type="count", unit_examples=["件", "起"], aliases=["客户投诉", "投诉处理率"]),
    _ql("data_security", "数据安全管理", "S", "数据安全与客户隐私", aliases=["数据安全", "网络安全", "信息安全"]),
    _ql("customer_privacy", "客户隐私保护", "S", "数据安全与客户隐私", aliases=["隐私保护", "客户信息保护", "个人信息保护"]),
    _ql("supply_chain_management", "供应链管理", "S", "供应链安全", aliases=["供应链安全", "供应商管理", "供应链风险"]),
    _q("supplier_total", "供应商数量", "S", "供应链安全", unit_type="count", unit_examples=["家"], aliases=["供应商总数", "供应商数量"]),
    _hy("supplier_esg_assessment", "供应商ESG或可持续评估", "S", "供应链安全", unit_type="count_ratio", unit_examples=["家", "%"], aliases=["供应商ESG评估", "供应商环境社会评估", "供应商审核"]),
    _ql("responsible_procurement", "负责任采购", "S", "供应链安全", aliases=["绿色采购", "可持续采购", "责任采购"]),
    _q("innovation_rd_investment", "研发投入", "S", "创新驱动", unit_type="money", unit_examples=["万元", "亿元"], aliases=["研发费用", "研发投入金额", "研发支出"]),
    _q("patents_ip", "专利与知识产权", "S", "创新驱动", unit_type="count", unit_examples=["项", "件"], aliases=["专利数量", "知识产权", "发明专利"]),
    _ql("rural_revitalization", "乡村振兴", "S", "乡村振兴", aliases=["乡村振兴", "产业帮扶", "定点帮扶"]),
    _hy("social_contribution", "公益慈善与社会贡献", "S", "社会贡献", unit_type="money", unit_examples=["万元", "亿元"], aliases=["公益捐赠", "慈善捐赠", "志愿服务"]),
    _hy("board_structure", "董事会结构", "G", "公司治理", unit_type="people_ratio", unit_examples=["人", "%"], aliases=["董事会构成", "董事人数"]),
    _q("independent_directors", "独立董事情况", "G", "公司治理", unit_type="people_ratio", unit_examples=["人", "%"], aliases=["独立董事人数", "独立董事比例"]),
    _ql("board_diversity", "董事会多元化", "G", "公司治理", aliases=["董事会多元化", "女性董事", "专业背景多元化"]),
    _ql("esg_governance_structure", "ESG或可持续发展治理架构", "G", "可持续发展治理", aliases=["ESG治理架构", "可持续发展委员会", "ESG工作小组"], review_priority="high"),
    _ql("stakeholder_communication", "利益相关方沟通", "G", "可持续发展治理", aliases=["利益相关方", "实质性议题", "重要性评估"]),
    _ql("information_disclosure", "信息披露管理", "G", "公司治理", aliases=["信息披露", "披露管理", "透明度"]),
    _ql("investor_relations", "投资者关系管理", "G", "公司治理", aliases=["投资者关系", "股东沟通", "业绩说明会"]),
    _ql("business_ethics", "商业道德", "G", "商业行为", aliases=["商业道德", "诚信经营", "公平竞争"]),
    _hy("anti_corruption", "反商业贿赂与反贪污", "G", "商业行为", unit_type="count_hours", unit_examples=["次", "人次", "小时"], aliases=["反贪污", "反腐败", "反商业贿赂", "廉洁从业"]),
    _ql("risk_compliance_management", "风险管理与合规管理", "G", "公司治理", aliases=["风险管理", "合规管理", "内控体系"], review_priority="high"),
]

A_SHARE_SCHEMA = {item["field_key"]: item for item in A_SHARE_SCHEMA_DATA}
A_SHARE_FIELD_KEYS = [item["field_key"] for item in A_SHARE_SCHEMA_DATA]
A_SHARE_NUMERIC_FIELD_KEYS = [
    item["field_key"] for item in A_SHARE_SCHEMA_DATA if item["indicator_type"] == "quantitative"
]
A_SHARE_TEXT_FIELD_KEYS = [
    item["field_key"] for item in A_SHARE_SCHEMA_DATA if item["indicator_type"] == "qualitative"
]


def a_share_schema_summary() -> Dict[str, int]:
    return {
        "total": len(A_SHARE_SCHEMA_DATA),
        "quantitative": len(A_SHARE_NUMERIC_FIELD_KEYS),
        "qualitative": len(A_SHARE_TEXT_FIELD_KEYS),
        "hybrid": sum(1 for item in A_SHARE_SCHEMA_DATA if item["indicator_type"] == "hybrid"),
        "E": sum(1 for item in A_SHARE_SCHEMA_DATA if item["category"] == "E"),
        "S": sum(1 for item in A_SHARE_SCHEMA_DATA if item["category"] == "S"),
        "G": sum(1 for item in A_SHARE_SCHEMA_DATA if item["category"] == "G"),
    }


__all__ = [
    "A_SHARE_FIELD_KEYS",
    "A_SHARE_NUMERIC_FIELD_KEYS",
    "A_SHARE_SCHEMA",
    "A_SHARE_SCHEMA_DATA",
    "A_SHARE_SCHEMA_VERSION",
    "A_SHARE_TEXT_FIELD_KEYS",
    "a_share_schema_summary",
]
