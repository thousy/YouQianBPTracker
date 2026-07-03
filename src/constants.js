// constants.js
// 定义血压等级以及颜色、图标等全局常量
export const BP_LEVELS = {
    LOW: { class: 'badge-low', label: '低血压', color: '#3b82f6', desc: '血压偏低。建议注意营养，避免突然起立致头晕，必要时咨询医生。' },
    NORMAL: { class: 'badge-normal', label: '正常血压', color: '#10b981', desc: '血压状态极佳，属于健康范围。请继续保持良好的生活习惯！' },
    PREHIGH: { class: 'badge-prehigh', label: '正常偏高', color: '#f59e0b', desc: '血压处于正常偏高范围。建议注意低盐低脂饮食，规律作息和适度运动。' },
    STAGE1: { class: 'badge-stage1', label: '轻度高血压', color: '#f97316', desc: '属于1级高血压。建议限制食盐摄入，控制体重，定期监测血压，必要时就诊。' },
    STAGE2: { class: 'badge-stage2', label: '中重度高血压', color: '#ef4444', desc: '血压处于较高风险级别。请尽快咨询专业医生，按医嘱进行调理或药物治疗。' }
};

export const THEME_COLORS = {
    light: {
        textMain: '#000000',
        textMuted: '#4b5563',
        primary: '#2563eb'
    },
    dark: {
        textMain: '#ffffff',
        textMuted: '#9ca3af',
        primary: '#3b82f6'
    }
};
